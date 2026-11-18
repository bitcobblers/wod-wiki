import { Moon, Sun } from "lucide-react"
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { useTheme } from "@/contexts/ThemeProvider"

export function ThemeToggle() {
    const { setTheme, theme } = useTheme()

    const toggleTheme = () => {
        if (theme === 'dark') {
            setTheme('light')
        } else if (theme === 'light') {
            setTheme('dark')
        } else {
            // System mode
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
            setTheme(systemTheme === "dark" ? "light" : "dark")
        }
    }

    return (
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
        </Button>
    )
}
