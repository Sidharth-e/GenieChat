export const ThemeScript = () => {
  const scriptContent = `
    (function() {
      try {
        const savedTheme = localStorage.getItem("theme");
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        
        let themeToApply;
        
        if (savedTheme === "dark" || savedTheme === "light") {
          themeToApply = savedTheme;
        } else {
          themeToApply = systemTheme;
        }
        
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(themeToApply);
        
        // Save the resolved theme to a data attribute for easier debugging/access if needed
        root.setAttribute("data-theme", themeToApply);
      } catch (e) {
        console.error("Theme script failed", e);
      }
    })();
  `;

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: scriptContent,
      }}
    />
  );
};
