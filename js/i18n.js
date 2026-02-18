let currentLang = "en"

async function loadLang(lang) {
    const response = await fetch(`/lang/${lang}.json`)
    const translations = await response.json()

    document.querySelectorAll("[data-i18n]").forEach(element => {
        const key = element.getAttribute("data-i18n")
        element.textContent = translations[key]
    })

    currentLang = lang
    localStorage.setItem("lang", lang)
}

function setLang(lang) {
    loadLang(lang)
}

window.addEventListener("DOMContentLoaded", () => {
    const savedLang = localStorage.getItem("lang")
    if (savedLang) {
        loadLang(savedLang)
    } else {
        const browserLang = navigator.language.startsWith("pt") ? "pt" : "en"
        loadLang(browserLang)
    }
})
