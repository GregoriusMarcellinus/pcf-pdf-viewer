/**
 * Feature-complete accessible HTML toolbar for Mozilla pdf.js PCF viewer.
 * Accurately styled and organized matching https://mozilla.github.io/pdf.js/web/viewer.html.
 */

export type ToolDisplayMode = "Edit" | "View" | "Disabled";

export interface ToolItemConfig {
    visible: boolean;
    displayMode: ToolDisplayMode;
}

export interface ToolActionConfig {
    highlight: ToolItemConfig;
    draw: ToolItemConfig;
    text: ToolItemConfig;
    stamp: ToolItemConfig;
    print: ToolItemConfig;
    download: ToolItemConfig;
}

export interface ToolbarCallbacks {
    onPrevPage: () => void;
    onNextPage: () => void;
    onGoToPage: (pageNumber: number) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomPreset: (preset: string) => void;
    onToggleSidebar?: () => void;
    onToggleFind?: () => void;
    onToggleAnnotation?: (tool: "highlight" | "draw" | "text" | "stamp") => void;
    onPrint?: () => void;
    onDownload?: () => void;
    onFirstPage?: () => void;
    onLastPage?: () => void;
    onRotateClockwise?: () => void;
    onRotateCounterclockwise?: () => void;
    onTogglePresentationMode?: () => void;
    onScrollModeChange?: (mode: number) => void;
    onSpreadModeChange?: (mode: number) => void;
    onShowProperties?: () => void;
}

export class Toolbar {
    public element: HTMLDivElement;

    // Left controls
    private sidebarBtn: HTMLButtonElement;
    private findBtn: HTMLButtonElement;
    private prevBtn: HTMLButtonElement;
    private nextBtn: HTMLButtonElement;
    private pageInput: HTMLInputElement;
    private totalPagesSpan: HTMLSpanElement;

    // Middle controls
    private zoomOutBtn: HTMLButtonElement;
    private zoomInBtn: HTMLButtonElement;
    private zoomSelect: HTMLSelectElement;

    // Right controls
    private highlightBtn: HTMLButtonElement;
    private drawBtn: HTMLButtonElement;
    private textBtn: HTMLButtonElement;
    private stampBtn: HTMLButtonElement;
    private printBtn: HTMLButtonElement;
    private downloadBtn: HTMLButtonElement;
    private secondaryMenuBtn: HTMLButtonElement;
    private secondaryMenu: HTMLDivElement;

    // Active state trackers for secondary menu items
    private currentScrollMode = 0; // VERTICAL
    private currentSpreadMode = 0; // NONE

    private isSecondaryMenuOpen = false;
    private currentPage = 1;
    private totalPages = 1;

    private annActionsDivider!: HTMLDivElement;
    private isDocumentLoaded = false;
    private toolConfig: ToolActionConfig = {
        highlight: { visible: true, displayMode: "Edit" },
        draw: { visible: true, displayMode: "Edit" },
        text: { visible: true, displayMode: "Edit" },
        stamp: { visible: true, displayMode: "Edit" },
        print: { visible: true, displayMode: "Edit" },
        download: { visible: true, displayMode: "Edit" }
    };

    constructor(private callbacks: ToolbarCallbacks) {
        this.element = document.createElement("div");
        this.element.className = "pdfv-toolbar";
        this.element.setAttribute("role", "toolbar");
        this.element.setAttribute("aria-label", "PDF Viewer Controls");

        // ==========================================
        // GROUP 1: Left (Sidebar, Find, Navigation)
        // ==========================================
        const leftGroup = document.createElement("div");
        leftGroup.className = "pdfv-toolbar-group";

        // Sidebar Toggle
        this.sidebarBtn = this.createButton(
            "Toggle Sidebar",
            '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h5V6H4zm7 0v12h9V6h-9z"/></svg>',
            () => this.callbacks.onToggleSidebar?.()
        );
        leftGroup.appendChild(this.sidebarBtn);

        // Find in Document (Ctrl+F)
        this.findBtn = this.createButton(
            "Find in Document (Ctrl+F)",
            '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
            () => this.callbacks.onToggleFind?.()
        );
        leftGroup.appendChild(this.findBtn);

        // Divider
        leftGroup.appendChild(this.createDivider());

        // Previous Page
        this.prevBtn = this.createButton(
            "Previous Page",
            '<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>',
            () => this.callbacks.onPrevPage()
        );
        leftGroup.appendChild(this.prevBtn);

        // Next Page
        this.nextBtn = this.createButton(
            "Next Page",
            '<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>',
            () => this.callbacks.onNextPage()
        );
        leftGroup.appendChild(this.nextBtn);

        // Page Number Input & Total
        const pageNav = document.createElement("div");
        pageNav.className = "pdfv-page-nav";

        this.pageInput = document.createElement("input");
        this.pageInput.type = "text";
        this.pageInput.className = "pdfv-page-input";
        this.pageInput.value = "1";
        this.pageInput.setAttribute("aria-label", "Page Number");
        this.pageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                this.commitPageInput();
            }
        });
        this.pageInput.addEventListener("blur", () => this.commitPageInput());
        pageNav.appendChild(this.pageInput);

        this.totalPagesSpan = document.createElement("span");
        this.totalPagesSpan.className = "pdfv-page-total";
        this.totalPagesSpan.textContent = "of 1";
        pageNav.appendChild(this.totalPagesSpan);

        leftGroup.appendChild(pageNav);
        this.element.appendChild(leftGroup);

        // ==========================================
        // GROUP 2: Middle (Zoom Out, Zoom In, Zoom Preset)
        // ==========================================
        const middleGroup = document.createElement("div");
        middleGroup.className = "pdfv-toolbar-group";

        this.zoomOutBtn = this.createButton(
            "Zoom Out",
            '<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>',
            () => this.callbacks.onZoomOut()
        );
        middleGroup.appendChild(this.zoomOutBtn);

        this.zoomInBtn = this.createButton(
            "Zoom In",
            '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
            () => this.callbacks.onZoomIn()
        );
        middleGroup.appendChild(this.zoomInBtn);

        this.zoomSelect = document.createElement("select");
        this.zoomSelect.className = "pdfv-zoom-select";
        this.zoomSelect.setAttribute("aria-label", "Zoom Level");

        const options = [
            { label: "Automatic Zoom", value: "auto" },
            { label: "Page Width", value: "page-width" },
            { label: "Page Fit", value: "page-fit" },
            { label: "50%", value: "0.5" },
            { label: "75%", value: "0.75" },
            { label: "100%", value: "1.0" },
            { label: "125%", value: "1.25" },
            { label: "150%", value: "1.5" },
            { label: "200%", value: "2.0" },
            { label: "300%", value: "3.0" },
            { label: "400%", value: "4.0" }
        ];

        for (const opt of options) {
            const optElem = document.createElement("option");
            optElem.value = opt.value;
            optElem.textContent = opt.label;
            this.zoomSelect.appendChild(optElem);
        }

        this.zoomSelect.addEventListener("change", () => {
            this.callbacks.onZoomPreset(this.zoomSelect.value);
        });

        middleGroup.appendChild(this.zoomSelect);
        this.element.appendChild(middleGroup);

        // ==========================================
        // GROUP 3: Right (Annotation Tools, Print, Download, Tools)
        // ==========================================
        const rightGroup = document.createElement("div");
        rightGroup.className = "pdfv-toolbar-group";

        // Highlight
        this.highlightBtn = this.createButton(
            "Highlight",
            '<svg viewBox="0 0 24 24"><path d="M6 19.5V21h12v-1.5H6zM17.71 8.04l-4.75-4.75c-.39-.39-1.02-.39-1.41 0L3.5 11.34c-.39.39-.39 1.02 0 1.41l4.75 4.75c.39.39 1.02.39 1.41 0l8.05-8.05c.39-.39.39-1.02 0-1.41zM9.66 16.09L5.41 11.84l6.01-6.01 4.25 4.25-6.01 6.01z"/></svg>',
            () => this.callbacks.onToggleAnnotation?.("highlight")
        );
        rightGroup.appendChild(this.highlightBtn);

        // Draw ink annotation
        this.drawBtn = this.createButton(
            "Draw ink annotation",
            '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
            () => this.callbacks.onToggleAnnotation?.("draw")
        );
        rightGroup.appendChild(this.drawBtn);

        // Add text comment
        this.textBtn = this.createButton(
            "Add text comment",
            '<svg viewBox="0 0 24 24"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>',
            () => this.callbacks.onToggleAnnotation?.("text")
        );
        rightGroup.appendChild(this.textBtn);

        // Add or edit images
        this.stampBtn = this.createButton(
            "Add or edit images",
            '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
            () => this.callbacks.onToggleAnnotation?.("stamp")
        );
        rightGroup.appendChild(this.stampBtn);

        // Divider
        this.annActionsDivider = this.createDivider();
        rightGroup.appendChild(this.annActionsDivider);

        // Print PDF
        this.printBtn = this.createButton(
            "Print PDF",
            '<svg viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>',
            () => this.callbacks.onPrint?.()
        );
        rightGroup.appendChild(this.printBtn);

        // Download PDF
        this.downloadBtn = this.createButton(
            "Download PDF",
            '<svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>',
            () => this.callbacks.onDownload?.()
        );
        rightGroup.appendChild(this.downloadBtn);

        // Secondary Tools Menu
        const moreWrapper = document.createElement("div");
        moreWrapper.className = "pdfv-dropdown-wrapper";

        this.secondaryMenuBtn = this.createButton(
            "Tools",
            '<svg viewBox="0 0 24 24"><path d="M6.4 18L5 16.6 9.6 12 5 7.4 6.4 6l6 6zm6.6 0l-1.4-1.4 4.6-4.6-4.6-4.6 1.4-1.4 6 6z"/></svg>',
            () => this.toggleSecondaryMenu()
        );
        moreWrapper.appendChild(this.secondaryMenuBtn);

        this.secondaryMenu = document.createElement("div");
        this.secondaryMenu.className = "pdfv-dropdown-menu";
        this.secondaryMenu.style.display = "none";
        this.populateSecondaryMenu();
        moreWrapper.appendChild(this.secondaryMenu);

        rightGroup.appendChild(moreWrapper);
        this.element.appendChild(rightGroup);

        // Click outside closes secondary menu
        document.addEventListener("click", (e) => {
            if (this.isSecondaryMenuOpen && !moreWrapper.contains(e.target as Node)) {
                this.closeSecondaryMenu();
            }
        });

        this.updateButtonsState();
    }

    public setPage(page: number, total: number): void {
        this.currentPage = page;
        this.totalPages = Math.max(1, total);
        this.pageInput.value = String(this.currentPage);
        this.totalPagesSpan.textContent = `of ${this.totalPages}`;
        this.updateButtonsState();
    }

    public setZoomValue(zoom: string): void {
        for (let i = 0; i < this.zoomSelect.options.length; i++) {
            if (this.zoomSelect.options[i].value === zoom) {
                this.zoomSelect.selectedIndex = i;
                return;
            }
        }
        const num = parseFloat(zoom);
        if (!isNaN(num)) {
            for (let i = 0; i < this.zoomSelect.options.length; i++) {
                const optNum = parseFloat(this.zoomSelect.options[i].value);
                if (!isNaN(optNum) && Math.abs(optNum - num) < 0.05) {
                    this.zoomSelect.selectedIndex = i;
                    return;
                }
            }
        }
    }

    public setToolbarVisible(visible: boolean): void {
        this.element.style.display = visible ? "flex" : "none";
    }

    public setSidebarActive(active: boolean): void {
        this.sidebarBtn.classList.toggle("pdfv-btn-active", active);
    }

    public setFindActive(active: boolean): void {
        this.findBtn.classList.toggle("pdfv-btn-active", active);
    }

    public setScrollModeState(mode: number): void {
        this.currentScrollMode = mode;
        this.populateSecondaryMenu();
    }

    public setSpreadModeState(mode: number): void {
        this.currentSpreadMode = mode;
        this.populateSecondaryMenu();
    }

    public setAnnotationToolActive(tool: "highlight" | "draw" | "text" | "stamp" | null): void {
        this.highlightBtn.classList.toggle("pdfv-btn-active", tool === "highlight");
        this.drawBtn.classList.toggle("pdfv-btn-active", tool === "draw");
        this.textBtn.classList.toggle("pdfv-btn-active", tool === "text");
        this.stampBtn.classList.toggle("pdfv-btn-active", tool === "stamp");
    }

    public setToolConfig(config: ToolActionConfig): void {
        this.toolConfig = config;
        this.applyAllButtonStates();
    }

    public setAllowDownload(allow: boolean): void {
        this.toolConfig.download.visible = allow;
        this.applyAllButtonStates();
    }

    public setEnabled(enabled: boolean): void {
        this.isDocumentLoaded = enabled;
        this.sidebarBtn.disabled = !enabled;
        this.findBtn.disabled = !enabled;
        this.prevBtn.disabled = !enabled || this.currentPage <= 1;
        this.nextBtn.disabled = !enabled || this.currentPage >= this.totalPages;
        this.pageInput.disabled = !enabled;
        this.zoomInBtn.disabled = !enabled;
        this.zoomOutBtn.disabled = !enabled;
        this.zoomSelect.disabled = !enabled;
        this.secondaryMenuBtn.disabled = !enabled;
        this.applyAllButtonStates();
    }

    private applyAllButtonStates(): void {
        this.applySingleToolState(this.highlightBtn, this.toolConfig.highlight);
        this.applySingleToolState(this.drawBtn, this.toolConfig.draw);
        this.applySingleToolState(this.textBtn, this.toolConfig.text);
        this.applySingleToolState(this.stampBtn, this.toolConfig.stamp);
        this.applySingleToolState(this.printBtn, this.toolConfig.print);
        this.applySingleToolState(this.downloadBtn, this.toolConfig.download);

        const hasVisibleAnnTools =
            this.toolConfig.highlight.visible ||
            this.toolConfig.draw.visible ||
            this.toolConfig.text.visible ||
            this.toolConfig.stamp.visible;

        const hasVisibleActionTools =
            this.toolConfig.print.visible ||
            this.toolConfig.download.visible;

        if (this.annActionsDivider) {
            this.annActionsDivider.style.display =
                hasVisibleAnnTools && hasVisibleActionTools ? "inline-block" : "none";
        }
    }

    private applySingleToolState(btn: HTMLButtonElement, item: ToolItemConfig): void {
        btn.style.display = item.visible ? "inline-flex" : "none";

        btn.classList.remove("pdfv-btn-disabled", "pdfv-btn-view");

        if (item.displayMode === "Disabled") {
            btn.disabled = true;
            btn.classList.add("pdfv-btn-disabled");
        } else if (item.displayMode === "View") {
            btn.disabled = true;
            btn.classList.add("pdfv-btn-view");
        } else {
            btn.disabled = !this.isDocumentLoaded;
        }
    }

    private toggleSecondaryMenu(): void {
        if (this.isSecondaryMenuOpen) {
            this.closeSecondaryMenu();
        } else {
            this.openSecondaryMenu();
        }
    }

    private openSecondaryMenu(): void {
        this.isSecondaryMenuOpen = true;
        this.populateSecondaryMenu();
        this.secondaryMenu.style.display = "block";
    }

    private closeSecondaryMenu(): void {
        this.isSecondaryMenuOpen = false;
        this.secondaryMenu.style.display = "none";
    }

    private populateSecondaryMenu(): void {
        this.secondaryMenu.innerHTML = "";

        // 1. Presentation Mode (Fullscreen)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Presentation Mode",
                '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onTogglePresentationMode?.();
                }
            )
        );

        // 2. Go to First Page
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Go to First Page",
                '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onFirstPage?.();
                }
            )
        );

        // 3. Go to Last Page
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Go to Last Page",
                '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onLastPage?.();
                }
            )
        );

        this.secondaryMenu.appendChild(this.createMenuDivider());

        // 4. Rotate Clockwise
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Rotate Clockwise",
                '<svg viewBox="0 0 24 24"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.85l-1.42 1.42c.59.78.97 1.73 1.09 2.75h1.95zm-1.62 5.85c.9-1.12 1.45-2.46 1.62-3.85h-1.95c-.12 1.02-.5 1.97-1.09 2.75l1.42 1.42zM13 17.9v2.02c1.39-.17 2.74-.71 3.86-1.61l-1.43-1.43c-.68.52-1.5.86-2.43 1.02z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onRotateClockwise?.();
                }
            )
        );

        // 5. Rotate Counterclockwise
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Rotate Counterclockwise",
                '<svg viewBox="0 0 24 24"><path d="M7.11 8.53L5.7 7.11C4.8 8.23 4.24 9.57 4.07 10.96h1.95c.12-1.02.5-1.97 1.09-2.75zm1.42 8.36L7.11 18.3c1.12.9 2.47 1.44 3.86 1.62v-2.02c-.93-.16-1.75-.5-2.43-1.02zM10.97 4.07V2.05c-1.39.17-2.74.72-3.86 1.62l1.42 1.42c.68-.53 1.51-.87 2.44-1.02zM8.45 5.55L13 1v3.07c3.94.49 7 3.85 7 7.93s-3.05 7.44-7 7.93v-2.02c2.84-.48 5-2.94 5-5.91s-2.16-5.43-5-5.91V10L8.45 5.55z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onRotateCounterclockwise?.();
                }
            )
        );

        this.secondaryMenu.appendChild(this.createMenuDivider());

        // 6. Page Scrolling (ScrollMode.PAGE = 3)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Page Scrolling",
                '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onScrollModeChange?.(3); // PAGE
                },
                this.currentScrollMode === 3
            )
        );

        // 7. Vertical Scrolling (ScrollMode.VERTICAL = 0)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Vertical Scrolling",
                '<svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onScrollModeChange?.(0); // VERTICAL
                },
                this.currentScrollMode === 0
            )
        );

        // 8. Horizontal Scrolling (ScrollMode.HORIZONTAL = 1)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Horizontal Scrolling",
                '<svg viewBox="0 0 24 24"><path d="M2 12l18.29-7.5.71.71L18 12l3 6.79-.71.71z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onScrollModeChange?.(1); // HORIZONTAL
                },
                this.currentScrollMode === 1
            )
        );

        // 9. Wrapped Scrolling (ScrollMode.WRAPPED = 2)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Wrapped Scrolling",
                '<svg viewBox="0 0 24 24"><path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onScrollModeChange?.(2); // WRAPPED
                },
                this.currentScrollMode === 2
            )
        );

        this.secondaryMenu.appendChild(this.createMenuDivider());

        // 10. No Spreads (SpreadMode.NONE = 0)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "No Spreads",
                '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onSpreadModeChange?.(0); // NONE
                },
                this.currentSpreadMode === 0
            )
        );

        // 11. Odd Spreads (SpreadMode.ODD = 1)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Odd Spreads",
                '<svg viewBox="0 0 24 24"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm-1 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onSpreadModeChange?.(1); // ODD
                },
                this.currentSpreadMode === 1
            )
        );

        // 12. Even Spreads (SpreadMode.EVEN = 2)
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Even Spreads",
                '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H6V7h5v10zm7 0h-5V7h5v10z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onSpreadModeChange?.(2); // EVEN
                },
                this.currentSpreadMode === 2
            )
        );

        this.secondaryMenu.appendChild(this.createMenuDivider());

        // 13. Document Properties
        this.secondaryMenu.appendChild(
            this.createMenuItem(
                "Document Properties...",
                '<svg viewBox="0 0 24 24"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>',
                () => {
                    this.closeSecondaryMenu();
                    this.callbacks.onShowProperties?.();
                }
            )
        );
    }

    private createMenuItem(
        label: string,
        iconSvg: string,
        onClick: () => void,
        isSelected = false
    ): HTMLButtonElement {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "pdfv-menu-item" + (isSelected ? " pdfv-menu-active" : "");
        const checkMark = isSelected
            ? '<span class="pdfv-menu-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>'
            : '<span class="pdfv-menu-check"></span>';

        item.innerHTML = `
            ${checkMark}
            <span class="pdfv-menu-icon">${iconSvg}</span>
            <span class="pdfv-menu-label">${label}</span>
        `;
        item.addEventListener("click", onClick);
        return item;
    }

    private createMenuDivider(): HTMLDivElement {
        const div = document.createElement("div");
        div.className = "pdfv-menu-divider";
        return div;
    }

    private commitPageInput(): void {
        const parsed = parseInt(this.pageInput.value, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > this.totalPages) {
            this.pageInput.value = String(this.currentPage);
            return;
        }
        if (parsed !== this.currentPage) {
            this.callbacks.onGoToPage(parsed);
        }
    }

    private updateButtonsState(): void {
        this.prevBtn.disabled = this.currentPage <= 1;
        this.nextBtn.disabled = this.currentPage >= this.totalPages;
    }

    private createButton(ariaLabel: string, innerSvg: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pdfv-btn";
        btn.setAttribute("aria-label", ariaLabel);
        btn.title = ariaLabel;
        btn.innerHTML = innerSvg;
        btn.addEventListener("click", onClick);
        return btn;
    }

    private createDivider(): HTMLDivElement {
        const div = document.createElement("div");
        div.className = "pdfv-toolbar-divider";
        div.setAttribute("aria-hidden", "true");
        return div;
    }
}
