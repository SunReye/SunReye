// Component-layer setup. Pin the Paraglide locale so a rendered message is the
// English copy whatever language the runner's Chromium reports.
import "./app.css";

localStorage.setItem("PARAGLIDE_LOCALE", "en");
