/**
 * Thumbnail Sidebar component for page jumping and preview.
 * Provides a clean panel with page cards, background thumbnail rendering,
 * and click-to-navigate.
 */
import { pdfjsLib } from "./pdfBootstrap";

export class Sidebar {
    public element: HTMLDivElement;
    private thumbnailList: HTMLDivElement;
    private isOpen = false;
    private currentPage = 1;
    private totalPages = 0;
    private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
    private renderedPages = new Set<number>();
    private isRendering = false;
    private renderQueue: number[] = [];

    constructor(
        private onSelectPage: (page: number) => void,
        private onToggleCallback?: (isOpen: boolean) => void
    ) {
        this.element = document.createElement("div");
        this.element.className = "pdfv-sidebar";
        this.element.style.display = "none";
        this.element.setAttribute("role", "navigation");
        this.element.setAttribute("aria-label", "Page Thumbnails");

        // Header
        const header = document.createElement("div");
        header.className = "pdfv-sidebar-header";

        const title = document.createElement("span");
        title.className = "pdfv-sidebar-title";
        title.textContent = "Page Thumbnails";
        header.appendChild(title);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "pdfv-btn pdfv-sidebar-close";
        closeBtn.setAttribute("aria-label", "Close Sidebar");
        closeBtn.title = "Close Sidebar";
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        closeBtn.addEventListener("click", () => this.close());
        header.appendChild(closeBtn);

        this.element.appendChild(header);

        // Thumbnail list container
        this.thumbnailList = document.createElement("div");
        this.thumbnailList.className = "pdfv-sidebar-list";
        this.element.appendChild(this.thumbnailList);
    }

    public getIsOpen(): boolean {
        return this.isOpen;
    }

    public setDocument(pdfDoc: pdfjsLib.PDFDocumentProxy): void {
        this.pdfDoc = pdfDoc;
        this.totalPages = pdfDoc.numPages;
        this.renderedPages.clear();
        this.renderQueue = [];
        this.renderThumbnailList();
    }

    public clear(): void {
        this.pdfDoc = null;
        this.totalPages = 0;
        this.renderedPages.clear();
        this.renderQueue = [];
        this.thumbnailList.innerHTML = "";
    }

    public toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    public open(): void {
        this.isOpen = true;
        this.element.style.display = "flex";
        this.onToggleCallback?.(true);
        this.updateActiveThumbnail();
        this.queueVisibleThumbnails();
    }

    public close(): void {
        this.isOpen = false;
        this.element.style.display = "none";
        this.onToggleCallback?.(false);
    }

    public setCurrentPage(page: number): void {
        this.currentPage = page;
        this.updateActiveThumbnail();
    }

    private renderThumbnailList(): void {
        this.thumbnailList.innerHTML = "";
        if (!this.pdfDoc || this.totalPages <= 0) return;

        for (let i = 1; i <= this.totalPages; i++) {
            const item = document.createElement("div");
            item.className = "pdfv-thumbnail-item";
            item.setAttribute("data-page-num", String(i));
            item.setAttribute("tabindex", "0");
            item.setAttribute("role", "button");
            item.setAttribute("aria-label", `Page ${i}`);

            const previewWrapper = document.createElement("div");
            previewWrapper.className = "pdfv-thumbnail-preview";

            const placeholder = document.createElement("div");
            placeholder.className = "pdfv-thumbnail-placeholder";
            placeholder.textContent = String(i);
            previewWrapper.appendChild(placeholder);

            item.appendChild(previewWrapper);

            const label = document.createElement("div");
            label.className = "pdfv-thumbnail-label";
            label.textContent = String(i);
            item.appendChild(label);

            item.addEventListener("click", () => {
                this.onSelectPage(i);
            });

            item.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.onSelectPage(i);
                }
            });

            this.thumbnailList.appendChild(item);
        }

        this.updateActiveThumbnail();
        if (this.isOpen) {
            this.queueVisibleThumbnails();
        }
    }

    private queueVisibleThumbnails(): void {
        if (!this.pdfDoc || this.totalPages <= 0) return;
        // Prioritize current page and its neighbors, then others
        const pagesToQueue: number[] = [];
        pagesToQueue.push(this.currentPage);
        for (let offset = 1; offset <= this.totalPages; offset++) {
            if (this.currentPage - offset >= 1) pagesToQueue.push(this.currentPage - offset);
            if (this.currentPage + offset <= this.totalPages) pagesToQueue.push(this.currentPage + offset);
        }

        for (const p of pagesToQueue) {
            if (!this.renderedPages.has(p) && !this.renderQueue.includes(p)) {
                this.renderQueue.push(p);
            }
        }
        void this.processRenderQueue();
    }

    private async processRenderQueue(): Promise<void> {
        if (this.isRendering || this.renderQueue.length === 0 || !this.pdfDoc) return;
        this.isRendering = true;

        while (this.renderQueue.length > 0 && this.isOpen && this.pdfDoc) {
            const pageNum = this.renderQueue.shift();
            if (!pageNum || this.renderedPages.has(pageNum)) continue;

            try {
                await this.renderThumbnailCanvas(pageNum);
                this.renderedPages.add(pageNum);
            } catch {
                // Ignore any render error and continue with queue
            }
            // Yield briefly to main thread between thumbnails
            await new Promise((resolve) => setTimeout(resolve, 30));
        }

        this.isRendering = false;
    }

    private async renderThumbnailCanvas(pageNum: number): Promise<void> {
        if (!this.pdfDoc) return;
        const itemElem = this.thumbnailList.querySelector(`[data-page-num="${pageNum}"]`);
        if (!itemElem) return;

        const previewWrapper = itemElem.querySelector(".pdfv-thumbnail-preview");
        if (!previewWrapper) return;

        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1.0 });
            const targetWidth = 100;
            const scale = Math.min(0.25, targetWidth / baseViewport.width);
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement("canvas");
            canvas.className = "pdfv-thumbnail-canvas";
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);

            const ctx = canvas.getContext("2d", { alpha: false });
            if (ctx) {
                await page.render({
                    canvasContext: ctx,
                    viewport
                }).promise;

                previewWrapper.innerHTML = "";
                previewWrapper.appendChild(canvas);
            }
        } catch {
            // Keep numerical placeholder if rendering is cancelled or fails
        }
    }

    private updateActiveThumbnail(): void {
        const items = this.thumbnailList.querySelectorAll(".pdfv-thumbnail-item");
        items.forEach((item) => {
            const pageNum = parseInt(item.getAttribute("data-page-num") || "0", 10);
            if (pageNum === this.currentPage) {
                item.classList.add("pdfv-thumbnail-active");
                if (this.isOpen) {
                    item.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            } else {
                item.classList.remove("pdfv-thumbnail-active");
            }
        });
    }
}
