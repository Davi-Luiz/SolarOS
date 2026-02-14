#!/usr/bin/env python3
"""
Solar Splash FS Shell v1.2
Sistema de arquivos personalizado para SolarOS
"""
import os
import struct
import shlex
import argparse
import subprocess
import re
import time
from dataclasses import dataclass
from pathlib import Path

# =========================
# Solar Splash FS v1.2
# =========================
SUPERBLOCK_SIZE = 512
NODE_SIZE = 64
MAX_NODES = 128

MAGIC = b"SOLAR_SPLASH".ljust(16, b"\x00")
VERSION = 1

TYPE_FILE = 0
TYPE_DIR = 1

INVALID = 0xFFFFFFFF

# Superblock offsets
SB_MAGIC = 0  # 16 bytes
SB_VERSION = 16  # u16
SB_NODE_COUNT = 32  # u32
SB_NODES_OFFSET = 64  # u32
SB_DATA_OFFSET = 128  # u32
SB_ROOT_NODE = 256  # u32

# Node layout (64 bytes)
NAME_MAX = 32  # bytes
FTYPE_MAX = 8  # bytes

NODE_NAME = 0  # 32 bytes (0..31)
NODE_FTYPE = 32  # 8 bytes  (32..39)
NODE_PARENT = 40  # u32      (40..43)
NODE_FIRST_CHILD = 44  # u32      (44..47)
NODE_NEXT_SIBLING = 48  # u32      (48..51)
NODE_DATA_OFFSET = 52  # u32      (52..55) relative to SB_DATA_OFFSET
NODE_DATA_SIZE = 56  # u32      (56..59)
NODE_TYPE = 60  # u8       (60)


# bytes 61..63 padding

@dataclass
class Node:
    name: str
    ftype: str
    parent: int
    first_child: int
    next_sibling: int
    data_off: int
    data_size: int
    ntype: int


class SolarFS:
    def __init__(self, path: str, auto_format: bool = False):
        self.path = path
        self.auto_format = auto_format

        self.nodes: list[Node] = []
        self.nodes_offset = 0
        self.data_offset = 0
        self.root = 0
        self.cwd = 0

        self._load()

    # ---------- low level ----------
    def _read_u16(self, f, off: int) -> int:
        f.seek(off)
        b = f.read(2)
        if len(b) != 2:
            raise EOFError("EOF ao ler u16")
        return struct.unpack("<H", b)[0]

    def _read_u32(self, f, off: int) -> int:
        f.seek(off)
        b = f.read(4)
        if len(b) != 4:
            raise EOFError("EOF ao ler u32")
        return struct.unpack("<I", b)[0]

    def _write_u16(self, f, off: int, v: int):
        f.seek(off)
        f.write(struct.pack("<H", v))

    def _write_u32(self, f, off: int, v: int):
        f.seek(off)
        f.write(struct.pack("<I", v))

    def _read_node_raw(self, f, i: int) -> bytes:
        f.seek(self.nodes_offset + i * NODE_SIZE)
        raw = f.read(NODE_SIZE)
        if len(raw) != NODE_SIZE:
            raise EOFError("EOF ao ler node")
        return raw

    def _write_node_raw(self, f, i: int, raw: bytes):
        if len(raw) != NODE_SIZE:
            raise ValueError("raw node size inválido")
        f.seek(self.nodes_offset + i * NODE_SIZE)
        f.write(raw)

    def _pack_node(self, node: Node) -> bytes:
        b = bytearray(NODE_SIZE)

        # name (até 31 bytes + \0)
        name_b = node.name.encode("utf-8")[:NAME_MAX - 1]
        b[NODE_NAME:NODE_NAME + len(name_b)] = name_b

        # ftype (8 bytes ASCII)
        ftype_b = node.ftype.encode("ascii", errors="ignore")[:FTYPE_MAX]
        ftype_b = ftype_b.ljust(FTYPE_MAX, b"\x00")
        b[NODE_FTYPE:NODE_FTYPE + FTYPE_MAX] = ftype_b

        # pointers/fields
        struct.pack_into("<I", b, NODE_PARENT, node.parent & 0xFFFFFFFF)
        struct.pack_into("<I", b, NODE_FIRST_CHILD, node.first_child & 0xFFFFFFFF)
        struct.pack_into("<I", b, NODE_NEXT_SIBLING, node.next_sibling & 0xFFFFFFFF)
        struct.pack_into("<I", b, NODE_DATA_OFFSET, node.data_off & 0xFFFFFFFF)
        struct.pack_into("<I", b, NODE_DATA_SIZE, node.data_size & 0xFFFFFFFF)

        b[NODE_TYPE] = node.ntype & 0xFF
        return bytes(b)

    def _unpack_node(self, raw: bytes) -> Node:
        name = raw[NODE_NAME:NODE_NAME + NAME_MAX].split(b"\x00")[0].decode("utf-8", errors="ignore")
        ftype = raw[NODE_FTYPE:NODE_FTYPE + FTYPE_MAX].split(b"\x00")[0].decode("ascii", errors="ignore")

        parent = struct.unpack("<I", raw[NODE_PARENT:NODE_PARENT + 4])[0]
        first_child = struct.unpack("<I", raw[NODE_FIRST_CHILD:NODE_FIRST_CHILD + 4])[0]
        next_sibling = struct.unpack("<I", raw[NODE_NEXT_SIBLING:NODE_NEXT_SIBLING + 4])[0]
        data_off = struct.unpack("<I", raw[NODE_DATA_OFFSET:NODE_DATA_OFFSET + 4])[0]
        data_size = struct.unpack("<I", raw[NODE_DATA_SIZE:NODE_DATA_SIZE + 4])[0]
        ntype = raw[NODE_TYPE]

        return Node(name, ftype, parent, first_child, next_sibling, data_off, data_size, ntype)

    def _load(self):
        with open(self.path, "rb") as f:
            m = f.read(16)
            if len(m) != 16 or m != MAGIC:
                if self.auto_format:
                    self.format()
                    return
                raise ValueError("Sem FS válido (MAGIC diferente). Use: format")

            ver = self._read_u16(f, SB_VERSION)
            if ver != VERSION:
                if self.auto_format:
                    self.format()
                    return
                raise ValueError(f"Versão inválida ({ver}). Use: format")

            node_count = self._read_u32(f, SB_NODE_COUNT)
            self.nodes_offset = self._read_u32(f, SB_NODES_OFFSET)
            self.data_offset = self._read_u32(f, SB_DATA_OFFSET)
            self.root = self._read_u32(f, SB_ROOT_NODE)

            if node_count == 0 or node_count > MAX_NODES:
                raise ValueError(f"FS inválido: node_count={node_count}")

            if self.nodes_offset < SUPERBLOCK_SIZE:
                raise ValueError("FS inválido: nodes_offset pequeno demais")

            if self.data_offset <= self.nodes_offset:
                raise ValueError("FS inválido: data_offset <= nodes_offset")

            if self.root >= node_count:
                raise ValueError("FS inválido: root fora do node_count")

            self.nodes = []
            for i in range(node_count):
                raw = self._read_node_raw(f, i)
                self.nodes.append(self._unpack_node(raw))

            self.cwd = self.root

    def _save_superblock_node_count(self):
        with open(self.path, "r+b") as f:
            self._write_u32(f, SB_NODE_COUNT, len(self.nodes))

    def _save_node(self, idx: int):
        with open(self.path, "r+b") as f:
            self._write_node_raw(f, idx, self._pack_node(self.nodes[idx]))

    def _append_node(self, node: Node) -> int:
        if len(self.nodes) >= MAX_NODES:
            raise RuntimeError("Sem espaço: MAX_NODES atingido")

        idx = len(self.nodes)
        self.nodes.append(node)

        with open(self.path, "r+b") as f:
            self._write_node_raw(f, idx, self._pack_node(node))

        self._save_superblock_node_count()
        return idx

    # ---------- path utils ----------
    def _node_path(self, idx: int) -> str:
        parts: list[str] = []
        cur = idx
        guard = 0
        while True:
            guard += 1
            if guard > MAX_NODES:
                return "/(corrupt)"

            n = self.nodes[cur]
            if n.name != "/":
                parts.append(n.name)

            if n.parent == INVALID:
                break

            if n.parent >= len(self.nodes):
                return "/(corrupt)"
            cur = n.parent

        parts.reverse()
        return "/" + "/".join(parts) if parts else "/"

    def pwd(self) -> str:
        return self._node_path(self.cwd)

    def _iter_children(self, dir_idx: int):
        n = self.nodes[dir_idx]
        c = n.first_child
        guard = 0
        while c != INVALID:
            guard += 1
            if guard > MAX_NODES:
                break
            yield c
            c = self.nodes[c].next_sibling

    def _find_child_by_name(self, dir_idx: int, name: str) -> int | None:
        for c in self._iter_children(dir_idx):
            if self.nodes[c].name == name:
                return c
        return None

    def _split_path(self, path: str) -> list[str]:
        p = path.strip()
        if p in ("", "/"):
            return []
        return [x for x in p.split("/") if x]

    def _resolve(self, path: str) -> int:
        if path.startswith("/"):
            cur = self.root
            parts = self._split_path(path)
        else:
            cur = self.cwd
            parts = self._split_path(path)

        for part in parts:
            if part == ".":
                continue
            if part == "..":
                if self.nodes[cur].parent != INVALID:
                    cur = self.nodes[cur].parent
                continue

            if self.nodes[cur].ntype != TYPE_DIR:
                raise FileNotFoundError("Caminho passa por algo que não é pasta")

            nxt = self._find_child_by_name(cur, part)
            if nxt is None:
                raise FileNotFoundError(f"Não existe: {part}")
            cur = nxt

        return cur

    # ---------- helpers ----------
    def _link_child(self, parent_idx: int, child_idx: int):
        p = self.nodes[parent_idx]
        if p.first_child == INVALID:
            p.first_child = child_idx
            self.nodes[parent_idx] = p
            self._save_node(parent_idx)
            return

        cur = p.first_child
        while self.nodes[cur].next_sibling != INVALID:
            cur = self.nodes[cur].next_sibling

        last = self.nodes[cur]
        last.next_sibling = child_idx
        self.nodes[cur] = last
        self._save_node(cur)

    # ---------- fs ops ----------
    def format(self):
        # layout:
        # [superblock 512]
        # [node table MAX_NODES * 64]
        # [data region ...]
        nodes_offset = SUPERBLOCK_SIZE
        data_offset = SUPERBLOCK_SIZE + NODE_SIZE * MAX_NODES

        # nodes:
        # 0 root
        # 1 drivers (dir)
        # 2 decoders (dir)
        # 3 kernel (file)
        root = Node("/", "", INVALID, 1, INVALID, 0, 0, TYPE_DIR)
        drivers = Node("drivers", "", 0, INVALID, 2, 0, 0, TYPE_DIR)
        decoders = Node("decoders", "", 0, INVALID, 3, 0, 0, TYPE_DIR)
        kernel = Node("kernel", "exe", 0, INVALID, INVALID, 0, 0, TYPE_FILE)

        with open(self.path, "r+b") as f:
            f.seek(0)
            f.write(b"\x00" * data_offset)  # limpa superblock + tabela

            sb = bytearray(SUPERBLOCK_SIZE)
            sb[SB_MAGIC:SB_MAGIC + 16] = MAGIC
            struct.pack_into("<H", sb, SB_VERSION, VERSION)
            struct.pack_into("<I", sb, SB_NODE_COUNT, 4)
            struct.pack_into("<I", sb, SB_NODES_OFFSET, nodes_offset)
            struct.pack_into("<I", sb, SB_DATA_OFFSET, data_offset)
            struct.pack_into("<I", sb, SB_ROOT_NODE, 0)

            f.seek(0)
            f.write(sb)

            f.seek(nodes_offset)
            f.write(self._pack_node(root))
            f.write(self._pack_node(drivers))
            f.write(self._pack_node(decoders))
            f.write(self._pack_node(kernel))

        self._load()

    def ls(self, path: str | None = None):
        idx = self.cwd if path is None else self._resolve(path)
        n = self.nodes[idx]
        if n.ntype != TYPE_DIR:
            return [(n.name, n.ntype, idx)]

        items = []
        for c in self._iter_children(idx):
            cn = self.nodes[c]
            items.append((cn.name, cn.ntype, c))
        return items

    def cd(self, path: str):
        idx = self._resolve(path)
        if self.nodes[idx].ntype != TYPE_DIR:
            raise NotADirectoryError("Isso não é pasta")
        self.cwd = idx

    def isfile(self, path: str) -> bool:
        idx = self._resolve(path)
        return self.nodes[idx].ntype == TYPE_FILE

    def isdir(self, path: str) -> bool:
        idx = self._resolve(path)
        return self.nodes[idx].ntype == TYPE_DIR

    def mkdir(self, path: str):
        path = path.strip()
        if path.endswith("/"):
            path = path[:-1]
        if path in ("", "/"):
            raise ValueError("nome inválido")

        base, name = os.path.split(path)
        parent_idx = self.cwd if base == "" else self._resolve(base)

        if self.nodes[parent_idx].ntype != TYPE_DIR:
            raise NotADirectoryError("Pai não é pasta")
        if self._find_child_by_name(parent_idx, name) is not None:
            raise FileExistsError("Já existe")

        new_idx = self._append_node(Node(name, "", parent_idx, INVALID, INVALID, 0, 0, TYPE_DIR))
        self._link_child(parent_idx, new_idx)

    def touch(self, path: str, ftype: str = "", ntype: int = TYPE_FILE):
        path = path.strip()
        if path.endswith("/"):
            raise ValueError("arquivo não deve terminar com /")

        base, name = os.path.split(path)
        parent_idx = self.cwd if base == "" else self._resolve(base)

        if self.nodes[parent_idx].ntype != TYPE_DIR:
            raise NotADirectoryError("Pai não é pasta")

        if self._find_child_by_name(parent_idx, name) is not None:
            return

        new_idx = self._append_node(Node(name, ftype, parent_idx, INVALID, INVALID, 0, 0, ntype))
        self._link_child(parent_idx, new_idx)

    def _alloc_data_end(self) -> int:
        end = 0
        for n in self.nodes:
            if n.ntype == TYPE_DIR:
                continue
            end = max(end, n.data_off + n.data_size)
        return end

    def cat(self, path: str) -> bytes:
        idx = self._resolve(path)
        n = self.nodes[idx]
        if n.ntype == TYPE_DIR:
            raise IsADirectoryError("Isso é pasta")
        with open(self.path, "rb") as f:
            f.seek(self.data_offset + n.data_off)
            return f.read(n.data_size)

    def write(self, path: str, data: bytes, mode: str = "overwrite"):
        try:
            idx = self._resolve(path)
        except FileNotFoundError:
            self.touch(path, "", TYPE_FILE)
            idx = self._resolve(path)

        n = self.nodes[idx]
        if n.ntype == TYPE_DIR:
            raise IsADirectoryError("Isso é pasta")

        if mode == "append" and n.data_size > 0:
            data2 = self.cat(path) + data
        else:
            data2 = data

        new_off = self._alloc_data_end()

        with open(self.path, "r+b") as f:
            f.seek(self.data_offset + new_off)
            f.write(data2)

        n.data_off = new_off
        n.data_size = len(data2)
        self.nodes[idx] = n
        self._save_node(idx)

    def stat(self, path: str) -> dict:
        """Retorna informações detalhadas sobre um arquivo/pasta"""
        idx = self._resolve(path)
        n = self.nodes[idx]
        return {
            'name': n.name,
            'type': 'directory' if n.ntype == TYPE_DIR else 'file',
            'ftype': n.ftype,
            'size': n.data_size,
            'parent_idx': n.parent,
            'path': self._node_path(idx)
        }


# =========================
# Loop helpers (Linux)
# =========================
def _losetup_associated_loops(img_path: str) -> list[str]:
    img_path = str(Path(img_path).resolve())
    try:
        out = subprocess.check_output(["losetup", "-j", img_path], text=True)
    except subprocess.CalledProcessError:
        return []
    out = out.strip()
    if not out:
        return []
    loops = re.findall(r"(/dev/loop\d+):", out)
    # remove duplicados preservando ordem
    seen = set()
    result = []
    for lp in loops:
        if lp not in seen:
            seen.add(lp)
            result.append(lp)
    return result


def _wait_part(loopdev: str, part: int, tries: int = 80, delay: float = 0.05) -> str:
    partdev = f"{loopdev}p{part}"
    for _ in range(tries):
        if os.path.exists(partdev):
            return partdev
        time.sleep(delay)
    return partdev


def ensure_loop_partition(img_path: str, part: int = 2) -> tuple[str, str | None]:
    """
    Garante que existe um loop para o .img.
    Retorna (partdev, loopdev_created_or_None).
    """
    img_path = str(Path(img_path).resolve())

    loops = _losetup_associated_loops(img_path)
    if loops:
        loopdev = loops[0]
        partdev = _wait_part(loopdev, part)
        if os.path.exists(partdev):
            return partdev, None
        try:
            subprocess.run(["sudo", "partprobe", loopdev], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            pass
        partdev = _wait_part(loopdev, part)
        if os.path.exists(partdev):
            return partdev, None

    loopdev = subprocess.check_output(
        ["sudo", "losetup", "--find", "--show", "-Pf", img_path],
        text=True
    ).strip()
    partdev = _wait_part(loopdev, part)
    return partdev, loopdev


def detach_loop(loopdev: str):
    subprocess.run(["sudo", "losetup", "-d", loopdev], check=False)


# =========================
# Shell helpers
# =========================
def human_type(t: int) -> str:
    return "Pasta" if t == TYPE_DIR else "Arquivo"


def import_bin(fs: SolarFS, host_path: str, dest_path: str) -> int:
    """Importa arquivo binário do sistema Linux para o SolarFS"""
    p = Path(host_path)
    if not p.exists():
        raise FileNotFoundError(f"Não existe no Linux: {host_path}")
    data = p.read_bytes()
    fs.write(dest_path, data, mode="overwrite")
    return len(data)


def export_bin(fs: SolarFS, src_path: str, host_path: str) -> int:
    """Exporta arquivo do SolarFS para o sistema Linux"""
    data = fs.cat(src_path)
    Path(host_path).write_bytes(data)
    return len(data)


# =========================
# Shell principal
# =========================
def main():
    ap = argparse.ArgumentParser(
        description="Solar Splash FS Shell (Python)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  # Usar com loop automático
  %(prog)s --img solaros.img --part 2

  # Usar com dispositivo direto
  %(prog)s /dev/loop0p2

  # Manter loop após sair
  %(prog)s --img solaros.img --keep-loop
        """
    )
    ap.add_argument("device", nargs="?",
                    help="Dispositivo do SolarFS (ex: /dev/loop1p2). Se omitir, usa --img/--part.")
    ap.add_argument("--img", default="./solaros.img",
                    help="Arquivo .img para auto-loop (padrão: ./solaros.img)")
    ap.add_argument("--part", type=int, default=2,
                    help="Partição do loop (padrão: 2)")
    ap.add_argument("--keep-loop", action="store_true",
                    help="Não desanexar o loop criado ao sair")
    args = ap.parse_args()

    created_loop = None

    if args.device:
        device = args.device
    else:
        partdev, created_loop = ensure_loop_partition(args.img, args.part)
        device = partdev

    fs_ready = False
    fs = None

    try:
        fs = SolarFS(device, auto_format=False)
        fs_ready = True
    except Exception as e:
        print(f"[!] Não consegui carregar SolarFS: {e}")
        fs_ready = False

    print("╔════════════════════════════════════════════════╗")
    print("║   Solar Shell - Solar Splash FS v1.2           ║")
    print("╚════════════════════════════════════════════════╝")
    print()
    print("Comandos disponíveis:")
    print("  format              - Formata o filesystem")
    print("  pwd                 - Mostra diretório atual")
    print("  cd <path>           - Muda de diretório")
    print("  ls [path]           - Lista arquivos/pastas")
    print("  mkdir <path>        - Cria pasta")
    print("  touch <path>        - Cria arquivo vazio")
    print("  cat <path>          - Mostra conteúdo do arquivo")
    print("  write <path> <txt>  - Escreve texto no arquivo")
    print("  append <path> <txt> - Adiciona texto ao arquivo")
    print("  stat <path>         - Mostra informações detalhadas")
    print("  importbin <src> <dst> - Importa arquivo do Linux")
    print("  exportbin <src> <dst> - Exporta arquivo para Linux")
    print("  isfile <path>       - Verifica se é arquivo")
    print("  isdir <path>        - Verifica se é pasta")
    print("  exit / quit         - Sair")
    print()

    try:
        while True:
            try:
                prompt = fs.pwd() if fs_ready else "/ (unformatted)"
                line = input(f"{prompt}> ").strip()
            except EOFError:
                print()
                break

            if not line:
                continue

            parts = shlex.split(line)
            cmd = parts[0]

            try:
                if cmd in ("exit", "quit"):
                    break

                elif cmd == "format":
                    tmp = SolarFS.__new__(SolarFS)
                    tmp.path = device
                    tmp.auto_format = False
                    tmp.nodes = []
                    tmp.nodes_offset = SUPERBLOCK_SIZE
                    tmp.data_offset = SUPERBLOCK_SIZE + NODE_SIZE * MAX_NODES
                    tmp.root = 0
                    tmp.cwd = 0
                    tmp.format()
                    fs = SolarFS(device, auto_format=False)
                    fs_ready = True
                    print("✓ Solar Splash formatado com sucesso!")

                elif not fs_ready:
                    print("[!] FS não está formatado. Use: format")

                elif cmd == "pwd":
                    print(fs.pwd())

                elif cmd == "cd":
                    if len(parts) != 2:
                        print("Uso: cd <path>")
                    else:
                        fs.cd(parts[1])
                        print(f"✓ Agora em: {fs.pwd()}")

                elif cmd == "ls":
                    path = parts[1] if len(parts) == 2 else None
                    items = fs.ls(path)
                    base = fs.pwd() if path is None else (
                        path if path.startswith("/") else
                        fs.pwd().rstrip("/") + "/" + path
                    )
                    base = base.replace("//", "/")
                    print(f"Listando: {base}")
                    if not items:
                        print("  (vazio)")
                    else:
                        for name, t, _idx in items:
                            full = (base.rstrip("/") + "/" + name).replace("//", "/") if name != "/" else "/"
                            tipo = human_type(t)
                            print(f"  [{tipo:8}] {name}")

                elif cmd == "stat":
                    if len(parts) != 2:
                        print("Uso: stat <path>")
                    else:
                        info = fs.stat(parts[1])
                        print(f"Nome:    {info['name']}")
                        print(f"Tipo:    {info['type']}")
                        print(f"FType:   {info['ftype'] or '(nenhum)'}")
                        print(f"Tamanho: {info['size']} bytes")
                        print(f"Caminho: {info['path']}")

                elif cmd == "isfile":
                    if len(parts) != 2:
                        print("Uso: isfile <path>")
                    else:
                        print("sim" if fs.isfile(parts[1]) else "não")

                elif cmd == "isdir":
                    if len(parts) != 2:
                        print("Uso: isdir <path>")
                    else:
                        print("sim" if fs.isdir(parts[1]) else "não")

                elif cmd == "cat":
                    if len(parts) != 2:
                        print("Uso: cat <path>")
                    else:
                        data = fs.cat(parts[1])
                        try:
                            print(data.decode("utf-8"))
                        except UnicodeDecodeError:
                            print(f"[Dados binários, {len(data)} bytes]")
                            print(data[:100])

                elif cmd == "write":
                    if len(parts) < 3:
                        print("Uso: write <path> <texto>")
                    else:
                        path = parts[1]
                        text = " ".join(parts[2:])
                        fs.write(path, text.encode("utf-8"), mode="overwrite")
                        print(f"✓ Escrito em: {path}")

                elif cmd == "append":
                    if len(parts) < 3:
                        print("Uso: append <path> <texto>")
                    else:
                        path = parts[1]
                        text = " ".join(parts[2:])
                        fs.write(path, text.encode("utf-8"), mode="append")
                        print(f"✓ Anexado em: {path}")

                elif cmd == "mkdir":
                    if len(parts) != 2:
                        print("Uso: mkdir <path>")
                    else:
                        fs.mkdir(parts[1])
                        print(f"✓ Pasta criada: {parts[1]}")

                elif cmd == "touch":
                    if len(parts) != 2:
                        print("Uso: touch <path>")
                    else:
                        fs.touch(parts[1], "", TYPE_FILE)
                        print(f"✓ Arquivo criado: {parts[1]}")

                elif cmd == "importbin":
                    if len(parts) != 3:
                        print("Uso: importbin <arquivo_linux> <caminho_solarfs>")
                    else:
                        n = import_bin(fs, parts[1], parts[2])
                        print(f"✓ Importado {n:,} bytes de '{parts[1]}' para '{parts[2]}'")

                elif cmd == "exportbin":
                    if len(parts) != 3:
                        print("Uso: exportbin <caminho_solarfs> <arquivo_linux>")
                    else:
                        n = export_bin(fs, parts[1], parts[2])
                        print(f"✓ Exportado {n:,} bytes de '{parts[1]}' para '{parts[2]}'")

                else:
                    print(f"[!] Comando desconhecido: {cmd}")
                    print("    Digite 'exit' para sair ou veja a lista de comandos acima")

            except Exception as e:
                print(f"[!] Erro: {e}")

    finally:
        if created_loop and (not args.keep_loop):
            print(f"[*] Desanexando loop: {created_loop}")
            detach_loop(created_loop)


if __name__ == "__main__":
    main()