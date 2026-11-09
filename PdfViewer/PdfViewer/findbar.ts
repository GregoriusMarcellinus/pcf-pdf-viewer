/**
 * Floating Find in Document (Ctrl+F) component using Mozilla PDFFindController.
 * Provides standard browser/document Ctrl+F experience:
 * - Floating overlay that doesn't reflow or push document content
 * - Intercepts Ctrl+F / Cmd+F keyboard shortcut
 * - Instant live search & highlighting
 * - Enter / Shift+Enter navigation
 * - Up / Down buttons
 * - Match counter ("x of y")
 * - Escape to dismiss
 */
import * as pdfjsViewer from "pdfjs-dist/legacy/web/pdf_viewer";

export class FindBar {
    public element: HTMLDivElement;
    private searchInput: HTMLInputElement;
    private prevBtn: HTMLButtonElement;
    private nextBtn: HTMLButtonElement;
    private matchCountSpan: HTMLSpanElement;
    private highlightAllCheckbox: HTMLInputElement;
    private matchCaseCheckbox: HTMLInputElement;
    private closeBtn: HTMLButtonElement;

    private isVisible = false;
    private debounceTimer: number | null = null;

    constructor(
        private eventBus: pdfjsViewer.EventBus,
        private onVisibilityChanged?: (isVisible: boolean) => void
    ) {
        this.element = document.createElement("div");
        this.element.className = "pdfv-findbar";
        this.element.style.display = "none";
        this.element.setAttribute("role", "search");
        this.element.setAttribute("aria-label", "Find in Document");

        // Search input
        this.searchInput = document.createElement("input");
        this.searchInput.type = "search";
        this.searchInput.className = "pdfv-find-input";
        this.searchInput.placeholder = "Find in document...";
        this.searchInput.setAttribute("aria-label", "Find in document");

        // Live search on typing
        this.searchInput.addEventListener("input", () => {
            const query = this.searchInput.value.trim();
            if (!query) {
                this.matchCountSpan.textContent = "";
                this.matchCountSpan.className = "pdfv-find-count";
            } else if (this.matchCountSpan.textContent === "Phrase not found") {
                this.matchCountSpan.textContent = "";
                this.matchCountSpan.className = "pdfv-find-count";
            }

            if (this.debounceTimer) {
                window.clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = window.setTimeout(() => {
                this.dispatchFind("", false);
            }, 120);
        });

        // Keyboard navigation
        this.searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.dispatchFind("again", e.shiftKey);
            } else if (e.key === "Escape") {
                e.preventDefault();
                this.hide();
            }
        });

        // Prev & Next match buttons
        this.prevBtn = this.createButton(
            "Previous match (Shift+Enter)",
            '<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>',
            () => this.dispatchFind("again", true)
        );

        this.nextBtn = this.createButton(
            "Next match (Enter)",
            '<svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>',
            () => this.dispatchFind("again", false)
        );

        // Match count display
        this.matchCountSpan = document.createElement("span");
        this.matchCountSpan.className = "pdfv-find-count";
        this.matchCountSpan.textContent = "";

        // Checkbox: Highlight All
        const highlightLabel = document.createElement("label");
        highlightLabel.className = "pdfv-find-option";
        this.highlightAllCheckbox = document.createElement("input");
        this.highlightAllCheckbox.type = "checkbox";
        this.highlightAllCheckbox.checked = true;
        this.highlightAllCheckbox.addEventListener("change", () => {
            this.dispatchFind("highlightallchange", false);
        });
        highlightLabel.appendChild(this.highlightAllCheckbox);
        highlightLabel.appendChild(document.createTextNode(" Highlight all"));

        // Checkbox: Match Case
        const caseLabel = document.createElement("label");
        caseLabel.className = "pdfv-find-option";
        this.matchCaseCheckbox = document.createElement("input");
        this.matchCaseCheckbox.type = "checkbox";
        this.matchCaseCheckbox.checked = false;
        this.matchCaseCheckbox.addEventListener("change", () => {
            this.dispatchFind("casesensitivitychange", false);
        });
        caseLabel.appendChild(this.matchCaseCheckbox);
        caseLabel.appendChild(document.createTextNode(" Match case"));

        // Close button
        this.closeBtn = this.createButton(
            "Close find bar (Esc)",
            '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
            () => this.hide()
        );

        // Assemble find bar elements
        this.element.appendChild(this.searchInput);
        this.element.appendChild(this.prevBtn);
        this.element.appendChild(this.nextBtn);
        this.element.appendChild(this.matchCountSpan);
        this.element.appendChild(highlightLabel);
        this.element.appendChild(caseLabel);
        this.element.appendChild(this.closeBtn);

        // Listen for match count updates from PDFFindController
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventBus.on("updatematchescount", (evt: any) => {
            this.updateMatchesCount(evt);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventBus.on("updatefindcontrolstate", (evt: any) => {
            this.updateFindControlState(evt);
        });
    }

    public getIsOpen(): boolean {
        return this.isVisible;
    }

    public toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    public show(prefillQuery?: string): void {
        this.isVisible = true;
        this.element.style.display = "flex";
        if (prefillQuery && prefillQuery.trim().length > 0) {
            this.searchInput.value = prefillQuery.trim();
        }
        this.searchInput.focus();
        this.searchInput.select();
        if (this.searchInput.value.trim().length > 0) {
            this.dispatchFind("", false);
        }
        this.onVisibilityChanged?.(true);
    }

    public hide(): void {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.element.style.display = "none";
        this.eventBus.dispatch("findbarclose", { source: this });
        this.onVisibilityChanged?.(false);
    }

    public reset(): void {
        this.searchInput.value = "";
        this.matchCountSpan.textContent = "";
        this.matchCountSpan.className = "pdfv-find-count";
    }

    private dispatchFind(type: string, findPrevious: boolean): void {
        const query = this.searchInput.value;
        this.eventBus.dispatch("find", {
            source: this,
            type,
            query,
            phraseSearch: true,
            caseSensitive: this.matchCaseCheckbox.checked,
            entireWord: false,
            highlightAll: this.highlightAllCheckbox.checked,
            findPrevious
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private updateMatchesCount(evt: any): void {
        if (!evt || !evt.matchesCount) {
            return;
        }
        const query = this.searchInput.value.trim();
        if (!query) {
            this.matchCountSpan.textContent = "";
            this.matchCountSpan.className = "pdfv-find-count";
            return;
        }
        const { current, total } = evt.matchesCount;
        if (total > 0) {
            this.matchCountSpan.textContent = `${current} of ${total}`;
            this.matchCountSpan.className = "pdfv-find-count";
        } else {
            this.matchCountSpan.textContent = "Phrase not found";
            this.matchCountSpan.className = "pdfv-find-count pdfv-find-nomatch";
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private updateFindControlState(evt: any): void {
        if (!evt) return;
        const query = this.searchInput.value.trim();
        if (!query) {
            this.matchCountSpan.textContent = "";
            this.matchCountSpan.className = "pdfv-find-count";
            return;
        }

        // FindState: 0: FOUND, 1: NOT_FOUND, 2: WRAPPED, 3: PENDING
        if (evt.state === 1) {
            // NOT_FOUND
            this.matchCountSpan.textContent = "Phrase not found";
            this.matchCountSpan.className = "pdfv-find-count pdfv-find-nomatch";
            return;
        }

        if (evt.state === 0 || evt.state === 2) {
            // FOUND or WRAPPED: clear any "Phrase not found" error
            this.matchCountSpan.className = "pdfv-find-count";
            if (evt.matchesCount && typeof evt.matchesCount.total === "number" && evt.matchesCount.total > 0) {
                this.matchCountSpan.textContent = `${evt.matchesCount.current} of ${evt.matchesCount.total}`;
            } else if (this.matchCountSpan.textContent === "Phrase not found") {
                this.matchCountSpan.textContent = "";
            }
            return;
        }

        if (evt.state === 3) {
            // PENDING
            this.matchCountSpan.className = "pdfv-find-count";
        }
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
}
