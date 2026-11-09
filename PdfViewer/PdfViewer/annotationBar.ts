/**
 * Annotation properties toolbar for Mozilla PDF.js viewer.
 * Provides intuitive color selection and line thickness / font size slider
 * for Highlight, Draw (Ink), and Text Comment.
 */

export type AnnotationToolType = "highlight" | "draw" | "text";

export interface AnnotationBarCallbacks {
    onColorChange: (tool: AnnotationToolType, color: string) => void;
    onThicknessChange: (tool: AnnotationToolType, thickness: number) => void;
    onClose?: () => void;
}

export class AnnotationBar {
    public element: HTMLDivElement;

    private activeTool: AnnotationToolType | null = null;

    // Persisted preferences per tool
    private colors: Record<AnnotationToolType, string> = {
        highlight: "#ffff00",
        draw: "#000000",
        text: "#000000"
    };

    private thicknesses: Record<AnnotationToolType, number> = {
        highlight: 14,
        draw: 2,
        text: 14 // Font size
    };

    // Color palettes per tool
    private palettes: Record<AnnotationToolType, string[]> = {
        highlight: ["#ffff00", "#00ff00", "#00ffff", "#ff70a6", "#ff9f1c"],
        draw: ["#000000", "#d93025", "#1a73e8", "#1e8e3e", "#f9ab00", "#9334e6"],
        text: ["#000000", "#d93025", "#1a73e8", "#1e8e3e", "#ffffff", "#f9ab00"]
    };

    // DOM references
    private badgeElement: HTMLSpanElement;
    private swatchesContainer: HTMLDivElement;
    private customColorInput: HTMLInputElement;
    private thicknessLabel: HTMLSpanElement;
    private thicknessSlider: HTMLInputElement;
    private thicknessValueSpan: HTMLSpanElement;
    private closeBtn: HTMLButtonElement;

    constructor(private callbacks: AnnotationBarCallbacks) {
        this.element = document.createElement("div");
        this.element.className = "pdfv-annotation-bar pdfv-hidden";
        this.element.style.display = "none";
        this.element.setAttribute("role", "toolbar");
        this.element.setAttribute("aria-label", "Annotation Properties");

        // 1. Tool Badge (Left)
        const leftGroup = document.createElement("div");
        leftGroup.className = "pdfv-ann-group";

        this.badgeElement = document.createElement("span");
        this.badgeElement.className = "pdfv-ann-badge";
        this.badgeElement.textContent = "Annotation";
        leftGroup.appendChild(this.badgeElement);

        this.element.appendChild(leftGroup);
        this.element.appendChild(this.createDivider());

        // 2. Color Group
        const colorGroup = document.createElement("div");
        colorGroup.className = "pdfv-ann-group";

        const colorLabel = document.createElement("span");
        colorLabel.className = "pdfv-ann-label";
        colorLabel.textContent = "Color:";
        colorGroup.appendChild(colorLabel);

        this.swatchesContainer = document.createElement("div");
        this.swatchesContainer.className = "pdfv-ann-swatches";
        colorGroup.appendChild(this.swatchesContainer);

        // Native color picker for custom hex
        const customColorWrapper = document.createElement("label");
        customColorWrapper.className = "pdfv-ann-custom-color";
        customColorWrapper.title = "Custom Color";

        this.customColorInput = document.createElement("input");
        this.customColorInput.type = "color";
        this.customColorInput.className = "pdfv-ann-color-input";
        this.customColorInput.addEventListener("input", () => {
            if (this.activeTool) {
                const newColor = this.customColorInput.value;
                this.colors[this.activeTool] = newColor;
                this.renderSwatches();
                this.callbacks.onColorChange(this.activeTool, newColor);
            }
        });
        customColorWrapper.appendChild(this.customColorInput);

        const customIcon = document.createElement("span");
        customIcon.className = "pdfv-ann-color-icon";
        customIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 18.23C4.13 18.45 4 18.76 4 19.07 4 19.7 4.51 20.21 5.14 20.21c.31 0 .62-.13.84-.35l.62-.62C8.14 20.47 9.99 21 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>`;
        customColorWrapper.appendChild(customIcon);
        colorGroup.appendChild(customColorWrapper);

        this.element.appendChild(colorGroup);
        this.element.appendChild(this.createDivider());

        // 3. Thickness / Font Size Group (clean, tidy slider and value badge)
        const thicknessGroup = document.createElement("div");
        thicknessGroup.className = "pdfv-ann-group pdfv-ann-thickness-group";

        this.thicknessLabel = document.createElement("span");
        this.thicknessLabel.className = "pdfv-ann-label";
        this.thicknessLabel.textContent = "Thickness:";
        thicknessGroup.appendChild(this.thicknessLabel);

        this.thicknessSlider = document.createElement("input");
        this.thicknessSlider.type = "range";
        this.thicknessSlider.className = "pdfv-ann-slider";
        this.thicknessSlider.addEventListener("input", () => {
            if (this.activeTool) {
                const val = parseInt(this.thicknessSlider.value, 10);
                this.thicknesses[this.activeTool] = val;
                this.thicknessValueSpan.textContent = `${val}px`;
                this.callbacks.onThicknessChange(this.activeTool, val);
            }
        });
        thicknessGroup.appendChild(this.thicknessSlider);

        this.thicknessValueSpan = document.createElement("span");
        this.thicknessValueSpan.className = "pdfv-ann-val";
        this.thicknessValueSpan.textContent = "2px";
        thicknessGroup.appendChild(this.thicknessValueSpan);

        this.element.appendChild(thicknessGroup);

        // 4. Spacer & Close Button
        const spacer = document.createElement("div");
        spacer.className = "pdfv-ann-spacer";
        this.element.appendChild(spacer);

        this.closeBtn = document.createElement("button");
        this.closeBtn.type = "button";
        this.closeBtn.className = "pdfv-ann-close";
        this.closeBtn.title = "Close Annotation Properties";
        this.closeBtn.setAttribute("aria-label", "Close Annotation Properties");
        this.closeBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
        this.closeBtn.addEventListener("click", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
            this.callbacks.onClose?.();
        });
        this.element.appendChild(this.closeBtn);
    }

    public show(tool: AnnotationToolType): void {
        this.activeTool = tool;
        this.element.classList.remove("pdfv-hidden");
        this.element.style.display = "flex";

        // Update badge and slider bounds based on tool
        if (tool === "highlight") {
            this.badgeElement.textContent = "Highlight";
            this.badgeElement.className = "pdfv-ann-badge pdfv-badge-highlight";
            this.thicknessLabel.textContent = "Thickness:";
            this.thicknessSlider.min = "4";
            this.thicknessSlider.max = "30";
            this.thicknessSlider.step = "1";
        } else if (tool === "draw") {
            this.badgeElement.textContent = "Draw";
            this.badgeElement.className = "pdfv-ann-badge pdfv-badge-draw";
            this.thicknessLabel.textContent = "Thickness:";
            this.thicknessSlider.min = "1";
            this.thicknessSlider.max = "20";
            this.thicknessSlider.step = "1";
        } else if (tool === "text") {
            this.badgeElement.textContent = "Text Comment";
            this.badgeElement.className = "pdfv-ann-badge pdfv-badge-text";
            this.thicknessLabel.textContent = "Font Size:";
            this.thicknessSlider.min = "8";
            this.thicknessSlider.max = "48";
            this.thicknessSlider.step = "2";
        }

        const currentThickness = this.thicknesses[tool];
        this.thicknessSlider.value = String(currentThickness);
        this.thicknessValueSpan.textContent = `${currentThickness}px`;
        this.customColorInput.value = this.colors[tool];

        this.renderSwatches();
    }

    public hide(): void {
        this.activeTool = null;
        this.element.classList.add("pdfv-hidden");
        this.element.style.display = "none";
    }

    public getIsOpen(): boolean {
        return !this.element.classList.contains("pdfv-hidden") && this.element.style.display !== "none";
    }

    public getCurrentTool(): AnnotationToolType | null {
        return this.activeTool;
    }

    public getColor(tool: AnnotationToolType): string {
        return this.colors[tool];
    }

    public getThickness(tool: AnnotationToolType): number {
        return this.thicknesses[tool];
    }

    public syncFromEditor(type: number, value: unknown): void {
        if (!this.activeTool) return;

        // FREETEXT_SIZE = 11, FREETEXT_COLOR = 12, INK_COLOR = 21, INK_THICKNESS = 22
        if ((type === 12 || type === 21) && typeof value === "string") {
            this.colors[this.activeTool] = value;
            this.customColorInput.value = value;
            this.renderSwatches();
        } else if ((type === 11 || type === 22) && typeof value === "number") {
            this.thicknesses[this.activeTool] = value;
            this.thicknessSlider.value = String(value);
            this.thicknessValueSpan.textContent = `${value}px`;
        }
    }

    private renderSwatches(): void {
        if (!this.activeTool) return;
        this.swatchesContainer.innerHTML = "";

        const palette = this.palettes[this.activeTool];
        const currentColor = this.colors[this.activeTool].toLowerCase();

        for (const hex of palette) {
            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = "pdfv-ann-swatch" + (hex.toLowerCase() === currentColor ? " pdfv-swatch-active" : "");
            swatch.style.backgroundColor = hex;
            swatch.title = hex;
            swatch.setAttribute("aria-label", `Color ${hex}`);

            swatch.addEventListener("click", () => {
                if (this.activeTool) {
                    this.colors[this.activeTool] = hex;
                    this.customColorInput.value = hex;
                    this.renderSwatches();
                    this.callbacks.onColorChange(this.activeTool, hex);
                }
            });

            this.swatchesContainer.appendChild(swatch);
        }
    }

    private createDivider(): HTMLDivElement {
        const div = document.createElement("div");
        div.className = "pdfv-ann-divider";
        div.setAttribute("aria-hidden", "true");
        return div;
    }
}
