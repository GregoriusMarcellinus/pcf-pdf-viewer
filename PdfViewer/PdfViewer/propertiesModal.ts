/**
 * Document Properties modal dialog showing PDF metadata.
 */
import { pdfjsLib } from "./pdfBootstrap";

export class PropertiesModal {
    public element: HTMLDivElement;
    private contentContainer: HTMLDivElement;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "pdfv-modal-overlay";
        this.element.style.display = "none";
        this.element.setAttribute("role", "dialog");
        this.element.setAttribute("aria-modal", "true");
        this.element.setAttribute("aria-label", "Document Properties");

        const modalBox = document.createElement("div");
        modalBox.className = "pdfv-modal-box";

        const header = document.createElement("div");
        header.className = "pdfv-modal-header";

        const title = document.createElement("h2");
        title.className = "pdfv-modal-title";
        title.textContent = "Document Properties";
        header.appendChild(title);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "pdfv-btn pdfv-modal-close";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        closeBtn.addEventListener("click", () => this.hide());
        header.appendChild(closeBtn);

        modalBox.appendChild(header);

        this.contentContainer = document.createElement("div");
        this.contentContainer.className = "pdfv-modal-body";
        modalBox.appendChild(this.contentContainer);

        const footer = document.createElement("div");
        footer.className = "pdfv-modal-footer";

        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "pdfv-btn pdfv-btn-primary";
        okBtn.textContent = "Close";
        okBtn.addEventListener("click", () => this.hide());
        footer.appendChild(okBtn);

        modalBox.appendChild(footer);
        this.element.appendChild(modalBox);

        // Click outside modal box to close
        this.element.addEventListener("click", (e) => {
            if (e.target === this.element) {
                this.hide();
            }
        });

        // Press Escape to close
        this.element.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                this.hide();
            }
        });
    }

    public async show(pdfDoc: pdfjsLib.PDFDocumentProxy, fileSize?: number): Promise<void> {
        this.contentContainer.innerHTML = '<div class="pdfv-loading-text">Loading properties...</div>';
        this.element.style.display = "flex";

        try {
            const data = await pdfDoc.getMetadata();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const info = (data?.info || {}) as Record<string, any>;
            const firstPage = await pdfDoc.getPage(1);
            const viewport = firstPage.getViewport({ scale: 1.0 });

            // Calculate dimensions in inches and mm (72 pt per inch)
            const widthInches = (viewport.width / 72).toFixed(2);
            const heightInches = (viewport.height / 72).toFixed(2);
            const widthMm = Math.round((viewport.width / 72) * 25.4);
            const heightMm = Math.round((viewport.height / 72) * 25.4);

            const rows: [string, string][] = [
                ["File Name:", "document.pdf"],
                ["File Size:", fileSize ? this.formatFileSize(fileSize) : "Unknown"],
                ["Title:", info.Title || "—"],
                ["Author:", info.Author || "—"],
                ["Subject:", info.Subject || "—"],
                ["Keywords:", info.Keywords || "—"],
                ["Creation Date:", info.CreationDate ? this.formatPdfDate(info.CreationDate) : "—"],
                ["Modification Date:", info.ModDate ? this.formatPdfDate(info.ModDate) : "—"],
                ["Creator / Application:", info.Creator || "—"],
                ["PDF Producer:", info.Producer || "—"],
                ["PDF Version:", info.PDFFormatVersion ? `PDF ${info.PDFFormatVersion}` : "1.7"],
                ["Page Count:", String(pdfDoc.numPages)],
                ["Page Size:", `${widthInches} × ${heightInches} in (${widthMm} × ${heightMm} mm)`]
            ];

            let html = '<table class="pdfv-props-table">';
            for (const [label, val] of rows) {
                html += `<tr><td class="pdfv-props-label">${this.escapeHtml(label)}</td><td class="pdfv-props-val">${this.escapeHtml(val)}</td></tr>`;
            }
            html += "</table>";

            this.contentContainer.innerHTML = html;
        } catch (err) {
            this.contentContainer.innerHTML = `<div class="pdfv-error-message">Failed to load document properties: ${err}</div>`;
        }
    }

    public hide(): void {
        this.element.style.display = "none";
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    private formatPdfDate(pdfDate: string): string {
        try {
            // PDF date format: D:YYYYMMDDHHmmSSOHH'mm'
            const clean = pdfDate.replace(/^D:/, "");
            const year = clean.substring(0, 4);
            const month = clean.substring(4, 6);
            const day = clean.substring(6, 8);
            if (year && month && day) {
                return `${year}-${month}-${day}`;
            }
        } catch {
            // Ignore parse errors
        }
        return pdfDate;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
