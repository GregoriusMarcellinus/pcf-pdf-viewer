import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { pdfjsLib } from "./pdfBootstrap";
import * as pdfjsViewer from "pdfjs-dist/legacy/web/pdf_viewer";
import { cleanupPdfWorker } from "./pdfWorkerHelper";
import { PdfLoader } from "./pdfLoader";
import { Toolbar, ToolActionConfig, ToolDisplayMode } from "./toolbar";
import { uint8ArrayToBase64 } from "./base64";

function parseDisplayMode(val: string | null | undefined): ToolDisplayMode {
    if (!val) return "Edit";
    const normalized = val.trim().toLowerCase();
    if (normalized === "disabled" || normalized === "disable") {
        return "Disabled";
    }
    if (normalized === "view") {
        return "View";
    }
    return "Edit";
}
import { FindBar } from "./findbar";
import { Sidebar } from "./sidebar";
import { PropertiesModal } from "./propertiesModal";
import { AnnotationBar } from "./annotationBar";

export class PdfViewer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private notifyOutputChanged!: () => void;
    private rootContainer!: HTMLDivElement;

    // View sub-elements
    private toolbar!: Toolbar;
    private annotationBar!: AnnotationBar;
    private findBar!: FindBar;
    private sidebar!: Sidebar;
    private propertiesModal!: PropertiesModal;
    private viewerWrapper!: HTMLDivElement;
    private viewerMain!: HTMLDivElement;
    private viewerContainer!: HTMLDivElement;
    private viewerElement!: HTMLDivElement;
    private placeholderElement!: HTMLDivElement;
    private loadingOverlay!: HTMLDivElement;
    private errorOverlay!: HTMLDivElement;
    private errorMessageElement!: HTMLDivElement;

    // pdf.js components
    private eventBus!: pdfjsViewer.EventBus;
    private linkService!: pdfjsViewer.PDFLinkService;
    private findController!: pdfjsViewer.PDFFindController;
    private pdfViewer!: pdfjsViewer.PDFViewer;
    private pdfLoader: PdfLoader = new PdfLoader();
    private currentPdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
    private currentRawBytes?: Uint8Array;
    private resizeObserver: ResizeObserver | null = null;

    // Control output states
    private currentPage = 0;
    private totalPages = 0;
    private loadStatus = "Idle";
    private errorMessage = "";
    private editedPdfBase64 = "";
    private refreshPdfTimeout: number | null = null;
    private isExportingPdf = false;
    private hasPendingExport = false;

    // Internal trackers
    private lastSourceFingerprint = "";
    private lastPassword = "";
    private currentZoom = "page-width";
    private lastGoToPage: number | null = null;

    // Annotation tool tracker
    private currentAnnotationTool: "highlight" | "draw" | "text" | "stamp" | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        (globalThis as unknown as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
        if (typeof window !== "undefined") {
            (window as unknown as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
        }

        this.notifyOutputChanged = notifyOutputChanged;
        context.mode.trackContainerResize(true);

        // Host container styling
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.minHeight = "400px";
        container.style.position = "relative";
        container.style.overflow = "hidden";

        // Root wrapper
        this.rootContainer = document.createElement("div");
        this.rootContainer.className = "pdfv-root";
        container.appendChild(this.rootContainer);

        // Setup pdf.js EventBus & LinkService first for callbacks
        this.eventBus = new pdfjsViewer.EventBus();
        this.linkService = new pdfjsViewer.PDFLinkService({
            eventBus: this.eventBus
        });
        this.findController = new pdfjsViewer.PDFFindController({
            linkService: this.linkService,
            eventBus: this.eventBus
        });

        // 1. Toolbar with callbacks
        this.toolbar = new Toolbar({
            onPrevPage: () => this.navigatePage(-1),
            onNextPage: () => this.navigatePage(1),
            onGoToPage: (page) => this.goToPage(page),
            onZoomIn: () => this.adjustZoom(0.25),
            onZoomOut: () => this.adjustZoom(-0.25),
            onZoomPreset: (preset) => this.setZoom(preset),
            onToggleSidebar: () => this.toggleSidebar(),
            onToggleFind: () => this.toggleFind(),
            onPrint: () => this.printDocument(),
            onDownload: () => this.downloadCurrentPdf(),
            onToggleAnnotation: (tool) => this.toggleAnnotationMode(tool),
            onFirstPage: () => this.goToPage(1),
            onLastPage: () => this.goToPage(this.totalPages),
            onRotateClockwise: () => this.rotatePages(90),
            onRotateCounterclockwise: () => this.rotatePages(-90),
            onTogglePresentationMode: () => this.togglePresentationMode(),
            onScrollModeChange: (mode) => this.setScrollMode(mode),
            onSpreadModeChange: (mode) => this.setSpreadMode(mode),
            onShowProperties: () => this.showProperties()
        });
        this.rootContainer.appendChild(this.toolbar.element);

        // 1b. Annotation Properties Bar (dynamic sub-toolbar for color & thickness)
        this.annotationBar = new AnnotationBar({
            onColorChange: (tool, color) => {
                this.applyAnnotationParams(tool, { color });
                this.queuePdfExport();
            },
            onThicknessChange: (tool, thickness) => {
                this.applyAnnotationParams(tool, { thickness });
                this.queuePdfExport();
            },
            onClose: () => {
                this.closeAnnotationMode();
            }
        });
        this.rootContainer.appendChild(this.annotationBar.element);

        // 2. Find Bar (floating search overlay)
        this.findBar = new FindBar(this.eventBus, (visible) => {
            this.toolbar.setFindActive(visible);
        });
        this.rootContainer.appendChild(this.findBar.element);

        // 3. Viewer Wrapper (holds Sidebar + Main Viewport in flex row)
        this.viewerWrapper = document.createElement("div");
        this.viewerWrapper.className = "pdfv-viewer-wrapper";

        // 3a. Left Thumbnail Sidebar
        this.sidebar = new Sidebar(
            (page) => this.goToPage(page),
            (isOpen) => this.toolbar.setSidebarActive(isOpen)
        );
        this.viewerWrapper.appendChild(this.sidebar.element);

        // 3b. Main Viewport Area & Absolutely Positioned Scroll Container
        this.viewerMain = document.createElement("div");
        this.viewerMain.className = "pdfv-viewer-main";

        this.viewerContainer = document.createElement("div");
        this.viewerContainer.className = "pdfv-container";
        this.viewerContainer.tabIndex = 0;
        this.viewerContainer.setAttribute("role", "region");
        this.viewerContainer.setAttribute("aria-label", "PDF Page Viewer");

        this.viewerElement = document.createElement("div");
        this.viewerElement.className = "pdfViewer";
        this.viewerContainer.appendChild(this.viewerElement);
        this.viewerMain.appendChild(this.viewerContainer);
        this.viewerWrapper.appendChild(this.viewerMain);
        this.rootContainer.appendChild(this.viewerWrapper);

        // 4. Document Properties Modal Dialog
        this.propertiesModal = new PropertiesModal();
        this.rootContainer.appendChild(this.propertiesModal.element);

        // 5. Neutral 'No Document' Placeholder
        this.placeholderElement = document.createElement("div");
        this.placeholderElement.className = "pdfv-placeholder";
        this.placeholderElement.innerHTML = `
            <svg class="pdfv-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
            </svg>
            <div class="pdfv-placeholder-title">No PDF document loaded</div>
            <div class="pdfv-placeholder-desc">Provide a valid base64 PDF, document URL, or Web API path to view it.</div>
        `;
        this.rootContainer.appendChild(this.placeholderElement);

        // 6. Loading Overlay
        this.loadingOverlay = document.createElement("div");
        this.loadingOverlay.className = "pdfv-loading-overlay";
        this.loadingOverlay.style.display = "none";
        this.loadingOverlay.innerHTML = `
            <div class="pdfv-spinner" role="status" aria-label="Loading PDF"></div>
            <div class="pdfv-loading-text">Loading PDF document...</div>
        `;
        this.rootContainer.appendChild(this.loadingOverlay);

        // 7. Error Overlay
        this.errorOverlay = document.createElement("div");
        this.errorOverlay.className = "pdfv-error-overlay";
        this.errorOverlay.style.display = "none";
        this.errorOverlay.innerHTML = `
            <svg class="pdfv-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div class="pdfv-error-title">Unable to Open PDF</div>
            <div class="pdfv-error-message"></div>
        `;
        this.errorMessageElement = this.errorOverlay.querySelector(".pdfv-error-message") as HTMLDivElement;
        this.rootContainer.appendChild(this.errorOverlay);

        // 8. Setup pdf.js Viewer Components with dummy altTextManager to avoid Mozilla PDF.js destroy null crash
        const dummyAltTextManager = {
            editAltText: () => { /* no-op */ },
            destroy: () => { /* no-op */ }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const viewerOptions: any = {
            container: this.viewerContainer,
            viewer: this.viewerElement,
            eventBus: this.eventBus,
            linkService: this.linkService,
            findController: this.findController,
            textLayerMode: 1, // Enable selectable text layer
            annotationMode: 2, // Enable form controls, links & interactive annotation editing
            altTextManager: dummyAltTextManager
        };

        this.pdfViewer = new pdfjsViewer.PDFViewer(viewerOptions);
        this.linkService.setViewer(this.pdfViewer);

        // Global Ctrl+F / Cmd+F handler for standard document search UX
        window.addEventListener("keydown", this.onKeyDownGlobal);

        // Event: Annotation editor mode changed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventBus.on("annotationeditormodechanged", (evt: any) => {
            if (evt && evt.mode === 0) {
                this.closeAnnotationMode();
                this.queuePdfExport();
            }
        });

        // Event: Annotation editor params changed (sync selected editor properties)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventBus.on("annotationeditorparamschanged", (evt: any) => {
            if (evt && evt.details && Array.isArray(evt.details)) {
                for (const [type, value] of evt.details) {
                    this.annotationBar.syncFromEditor(type, value);
                }
                this.queuePdfExport();
            }
        });

        // Event: Annotation editor states changed (created, deleted, selected, etc.)
        this.eventBus.on("annotationeditorstateschanged", () => {
            if (!this.isUserEditingText()) {
                this.queuePdfExport();
            }
        });

        // Export updated PDF whenever an annotation stroke, touch gesture, or stamp placement is made
        const onUserInteractionEnd = (): void => {
            window.setTimeout(() => {
                if (!this.isUserEditingText()) {
                    this.queuePdfExport();
                }
            }, 50);
        };

        this.viewerContainer.addEventListener("pointerup", onUserInteractionEnd);
        this.viewerContainer.addEventListener("mouseup", onUserInteractionEnd);
        this.viewerContainer.addEventListener("touchend", onUserInteractionEnd);

        // When focus leaves a text comment editor, queue export so committed text is saved
        this.viewerContainer.addEventListener("focusout", () => {
            window.setTimeout(() => {
                if (!this.isUserEditingText()) {
                    this.queuePdfExport();
                }
            }, 100);
        });

        this.viewerContainer.addEventListener("change", () => {
            if (!this.isUserEditingText()) {
                this.queuePdfExport();
            }
        });

        // Allow native context menu (Copy, Select All) by stopping event bubbling to Power Apps host
        this.viewerContainer.addEventListener("contextmenu", (e) => {
            e.stopPropagation();
        });

        // Event: Page change via scrolling or navigation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventBus.on("pagechanging", (evt: any) => {
            if (evt && typeof evt.pageNumber === "number") {
                this.updateCurrentPage(evt.pageNumber);
            }
        });

        // Event: Document pages rendered and ready for initial zoom
        this.eventBus.on("pagesinit", () => {
            this.applyZoom(this.currentZoom);
        });

        // Event: Scale change
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventBus.on("scalechanging", (evt: any) => {
            if (evt && evt.scale) {
                this.toolbar.setZoomValue(String(evt.scale));
            }
        });

        // Setup resize observation to re-fit page-width or page-fit zoom modes
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                this.handleContainerResize();
            });
            this.resizeObserver.observe(this.viewerContainer);
        }

        this.showPlaceholder();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        // Respect host visibility
        if (context.mode.isVisible === false) {
            this.rootContainer.style.display = "none";
            return;
        }
        this.rootContainer.style.display = "flex";

        // Set dimensions based on host allocation
        if (context.mode.allocatedHeight && context.mode.allocatedHeight > 0) {
            this.rootContainer.style.height = `${context.mode.allocatedHeight}px`;
        } else {
            this.rootContainer.style.height = "100%";
        }
        if (context.mode.allocatedWidth && context.mode.allocatedWidth > 0) {
            this.rootContainer.style.width = `${context.mode.allocatedWidth}px`;
        } else {
            this.rootContainer.style.width = "100%";
        }

        // Update toolbar visibility toggle without reload
        const showToolbar = context.parameters.ShowToolbar?.raw !== false;
        this.toolbar.setToolbarVisible(showToolbar);

        // Parse tool action visibilities and display modes
        const showHighlight = context.parameters.ShowHighlight?.raw !== false;
        const displayModeHighlight = parseDisplayMode(context.parameters.DisplayModeHighlight?.raw);

        const showDraw = context.parameters.ShowDraw?.raw !== false;
        const displayModeDraw = parseDisplayMode(context.parameters.DisplayModeDraw?.raw);

        const showText = context.parameters.ShowText?.raw !== false;
        const displayModeText = parseDisplayMode(context.parameters.DisplayModeText?.raw);

        const showStamp = context.parameters.ShowStamp?.raw !== false;
        const displayModeStamp = parseDisplayMode(context.parameters.DisplayModeStamp?.raw);

        const showPrint = context.parameters.ShowPrint?.raw !== false;
        const displayModePrint = parseDisplayMode(context.parameters.DisplayModePrint?.raw);

        const legacyAllowDownload = context.parameters.AllowDownload?.raw !== false;
        const showDownloadParam = context.parameters.ShowDownload?.raw !== false;
        const showDownload = legacyAllowDownload && showDownloadParam;
        const displayModeDownload = parseDisplayMode(context.parameters.DisplayModeDownload?.raw);

        const toolConfig: ToolActionConfig = {
            highlight: { visible: showHighlight, displayMode: displayModeHighlight },
            draw: { visible: showDraw, displayMode: displayModeDraw },
            text: { visible: showText, displayMode: displayModeText },
            stamp: { visible: showStamp, displayMode: displayModeStamp },
            print: { visible: showPrint, displayMode: displayModePrint },
            download: { visible: showDownload, displayMode: displayModeDownload }
        };

        this.toolbar.setToolConfig(toolConfig);

        // If currently active annotation tool was disabled, set to view, or hidden, turn off annotation mode
        if (this.currentAnnotationTool) {
            const activeConfig = toolConfig[this.currentAnnotationTool];
            if (!activeConfig || !activeConfig.visible || activeConfig.displayMode !== "Edit") {
                this.toggleAnnotationMode(this.currentAnnotationTool);
            }
        }

        // Check source and password
        const rawSource = context.parameters.PdfSource?.raw ?? "";
        const rawPassword = context.parameters.Password?.raw ?? "";
        const sourceFingerprint = this.calculateFingerprint(rawSource);
        const sourceChanged = sourceFingerprint !== this.lastSourceFingerprint;
        const passwordChanged = rawPassword !== this.lastPassword;

        // If source or password changed, initiate reload
        if (sourceChanged || (passwordChanged && this.loadStatus === "Error")) {
            this.lastSourceFingerprint = sourceFingerprint;
            this.lastPassword = rawPassword;

            if (!rawSource || rawSource.trim().length === 0) {
                this.showPlaceholder();
                this.currentPage = 0;
                this.totalPages = 0;
                this.updateOutputs({
                    loadStatus: "Idle",
                    errorMessage: "",
                    editedPdf: ""
                });
                return;
            }

            void this.loadDocument(rawSource, rawPassword, context);
            return;
        }

        // Apply Zoom if changed while document is loaded
        const requestedZoom = context.parameters.Zoom?.raw || "page-width";
        if (requestedZoom !== this.currentZoom) {
            this.currentZoom = requestedZoom;
            if (this.currentPdfDoc) {
                this.applyZoom(this.currentZoom);
            }
        }

        // Apply GoToPage if changed
        const requestedGoToPage = context.parameters.GoToPage?.raw;
        if (
            typeof requestedGoToPage === "number" &&
            requestedGoToPage > 0 &&
            requestedGoToPage !== this.lastGoToPage
        ) {
            this.lastGoToPage = requestedGoToPage;
            if (this.currentPdfDoc) {
                this.goToPage(requestedGoToPage);
            }
        }
    }

    public getOutputs(): IOutputs {
        return {
            LoadStatus: this.loadStatus,
            ErrorMessage: this.errorMessage,
            EditedPdf: this.editedPdfBase64
        };
    }

    public destroy(): void {
        if (this.refreshPdfTimeout !== null) {
            window.clearTimeout(this.refreshPdfTimeout);
            this.refreshPdfTimeout = null;
        }
        window.removeEventListener("keydown", this.onKeyDownGlobal);
        this.pdfLoader.cancelCurrentTask();

        if (this.sidebar) {
            this.sidebar.clear();
        }
        if (this.findBar) {
            this.findBar.reset();
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.pdfViewer) {
            try {
                this.pdfViewer.cleanup();
            } catch {
                // Ignore cleanup error
            }
        }

        if (this.currentPdfDoc) {
            try {
                this.currentPdfDoc.destroy();
            } catch {
                // Ignore document cleanup error
            }
            this.currentPdfDoc = null;
        }

        cleanupPdfWorker();

        while (this.rootContainer.firstChild) {
            this.rootContainer.removeChild(this.rootContainer.firstChild);
        }
    }

    private toggleSidebar(): void {
        this.sidebar.toggle();
        setTimeout(() => {
            this.handleContainerResize();
        }, 60);
    }

    private toggleFind(): void {
        if (this.findBar.getIsOpen()) {
            this.findBar.hide();
        } else {
            const selectedText = window.getSelection()?.toString();
            this.findBar.show(selectedText);
        }
    }

    private onKeyDownGlobal = (e: KeyboardEvent): void => {
        const activeEl = document.activeElement as HTMLElement | null;
        const isInputFocused =
            activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);

        if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
            // Intercept Ctrl+F / Cmd+F like standard PDF readers
            e.preventDefault();
            e.stopPropagation();
            const selectedText = window.getSelection()?.toString();
            this.findBar.show(selectedText);
            return;
        }
    };

    private async loadDocument(
        source: string,
        password: string,
        context: ComponentFramework.Context<IInputs>
    ): Promise<void> {
        this.showLoading();
        this.updateOutputs({ loadStatus: "Loading", errorMessage: "" });

        try {
            const result = await this.pdfLoader.load(source, password);

            const oldDoc = this.currentPdfDoc;
            this.currentPdfDoc = result.document;
            this.currentRawBytes = result.rawBytes;
            this.pdfViewer.setDocument(result.document);
            if (oldDoc) {
                try {
                    oldDoc.destroy();
                } catch {
                    // Ignore old doc destroy error
                }
            }
            this.linkService.setDocument(result.document, null);
            this.findController.setDocument(result.document);
            this.sidebar.setDocument(result.document);
            this.findBar.reset();

            this.totalPages = result.document.numPages;
            this.currentPage = 1;
            this.currentAnnotationTool = null;
            this.rootContainer.classList.remove("pdfv-annotating");

            this.showViewer();
            this.toolbar.setEnabled(true);
            this.toolbar.setAnnotationToolActive(null);
            this.annotationBar.hide();
            this.toolbar.setPage(1, this.totalPages);
            this.toolbar.setScrollModeState(this.pdfViewer.scrollMode ?? 0);
            this.toolbar.setSpreadModeState(this.pdfViewer.spreadMode ?? 0);

            this.updateOutputs({
                loadStatus: "Loaded",
                errorMessage: ""
            });

            // Listen for changes in PDF.js annotationStorage
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const docAny = result.document as any;
            if (docAny && docAny.annotationStorage) {
                docAny.annotationStorage.onSetModified = () => {
                    this.queuePdfExport();
                };
                docAny.annotationStorage.onResetModified = () => {
                    this.queuePdfExport();
                };
                docAny.annotationStorage.onAnnotationEditor = () => {
                    this.queuePdfExport();
                };
            }

            // Immediately serialize and emit the initial document Base64
            void this.refreshEditedPdfBase64();

            // Handle GoToPage if requested on initial load
            const requestedGoToPage = context.parameters.GoToPage?.raw;
            if (typeof requestedGoToPage === "number" && requestedGoToPage > 1) {
                this.lastGoToPage = requestedGoToPage;
                this.goToPage(requestedGoToPage);
            }
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : "Failed to load PDF document.";
            this.showError(errorMsg);
            this.updateOutputs({
                loadStatus: "Error",
                errorMessage: errorMsg,
                editedPdf: ""
            });
        }
    }

    private navigatePage(delta: number): void {
        if (!this.pdfViewer || !this.currentPdfDoc) return;
        const targetPage = this.pdfViewer.currentPageNumber + delta;
        this.goToPage(targetPage);
    }

    private goToPage(pageNumber: number): void {
        if (!this.pdfViewer || !this.currentPdfDoc) return;
        const clamped = Math.max(1, Math.min(pageNumber, this.totalPages));
        this.pdfViewer.currentPageNumber = clamped;
        this.updateCurrentPage(clamped);
    }

    private updateCurrentPage(page: number): void {
        if (this.currentPage !== page) {
            this.currentPage = page;
            this.toolbar.setPage(page, this.totalPages);
            this.sidebar.setCurrentPage(page);
        }
    }

    private adjustZoom(delta: number): void {
        if (!this.pdfViewer) return;
        const currentScale = this.pdfViewer.currentScale || 1.0;
        const newScale = Math.max(0.25, Math.min(5.0, Math.round((currentScale + delta) * 100) / 100));
        this.pdfViewer.currentScale = newScale;
        this.toolbar.setZoomValue(String(newScale));
    }

    private setZoom(preset: string): void {
        this.currentZoom = preset;
        this.applyZoom(preset);
    }

    private applyZoom(zoom: string): void {
        if (!this.pdfViewer) return;

        const normalized = (zoom || "page-width").toLowerCase().trim();
        if (
            normalized === "page-width" ||
            normalized === "page-fit" ||
            normalized === "auto"
        ) {
            this.pdfViewer.currentScaleValue = normalized;
            this.toolbar.setZoomValue(normalized);
            this.forceRender();
            return;
        }

        const num = parseFloat(normalized);
        if (!isNaN(num) && num > 0) {
            this.pdfViewer.currentScale = num;
            this.toolbar.setZoomValue(String(num));
        } else {
            this.pdfViewer.currentScaleValue = "page-width";
            this.toolbar.setZoomValue("page-width");
        }
        this.forceRender();
    }

    private handleContainerResize(): void {
        if (!this.currentPdfDoc || !this.pdfViewer) return;
        if (this.viewerContainer.clientWidth <= 50) return;

        // Re-fit responsive zoom presets when control dimensions change
        const currentScaleValue = this.pdfViewer.currentScaleValue;
        if (
            currentScaleValue === "page-width" ||
            currentScaleValue === "page-fit" ||
            currentScaleValue === "auto"
        ) {
            this.pdfViewer.currentScaleValue = currentScaleValue;
        }
        this.forceRender();
    }

    /**
     * Forces immediate update and page rendering on the pdf.js viewer.
     */
    private forceRender(): void {
        if (!this.pdfViewer) return;
        this.pdfViewer.update();
        try {
            // pdf_viewer.d.ts types currentlyVisiblePages as required, runtime defaults to internal visible views
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this.pdfViewer as any).forceRendering();
        } catch {
            // Suppress background render error
        }
    }

    private rotatePages(delta: number): void {
        if (!this.pdfViewer) return;
        const current = this.pdfViewer.pagesRotation || 0;
        this.pdfViewer.pagesRotation = (current + delta + 360) % 360;
        this.forceRender();
    }

    private togglePresentationMode(): void {
        if (!document.fullscreenElement) {
            void this.rootContainer.requestFullscreen?.();
        } else {
            void document.exitFullscreen?.();
        }
    }

    private closeAnnotationMode(): void {
        this.currentAnnotationTool = null;
        this.toolbar.setAnnotationToolActive(null);
        this.annotationBar.hide();
        this.rootContainer.classList.remove("pdfv-annotating");
        if (this.pdfViewer) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorMode = { mode: 0 };
            } catch {
                // Ignore
            }
        }
    }

    private toggleAnnotationMode(tool: "highlight" | "draw" | "text" | "stamp"): void {
        if (!this.pdfViewer) return;

        if (this.currentAnnotationTool === tool) {
            if (tool === "stamp") {
                // If stamp is already active, clicking it again prompts to pick another image
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 2 }; // CREATE
                } catch {
                    // Ignore
                }
                return;
            }

            this.closeAnnotationMode();
            return;
        }

        this.currentAnnotationTool = tool;
        this.toolbar.setAnnotationToolActive(tool);
        this.rootContainer.classList.add("pdfv-annotating");

        try {
            if (tool === "highlight") {
                // Set to INK mode (15) and apply user's chosen highlighter color & thickness
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorMode = { mode: 15 };
                this.annotationBar.show("highlight");
                this.applyAnnotationParams("highlight", {
                    color: this.annotationBar.getColor("highlight"),
                    thickness: this.annotationBar.getThickness("highlight")
                });
            } else if (tool === "draw") {
                // Set to INK mode (15) and apply user's chosen pen color & thickness
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorMode = { mode: 15 };
                this.annotationBar.show("draw");
                this.applyAnnotationParams("draw", {
                    color: this.annotationBar.getColor("draw"),
                    thickness: this.annotationBar.getThickness("draw")
                });
            } else if (tool === "text") {
                // Set to FREETEXT mode (3) and apply user's chosen font color & size
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorMode = { mode: 3 };
                this.annotationBar.show("text");
                this.applyAnnotationParams("text", {
                    color: this.annotationBar.getColor("text"),
                    thickness: this.annotationBar.getThickness("text")
                });
            } else if (tool === "stamp") {
                this.annotationBar.hide();
                // Set to STAMP mode (13) and prompt file selection for image placement
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorMode = { mode: 13 };
                try {
                    // CREATE (2) dispatches file picker and inserts image into the active page
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 2 };
                } catch {
                    // Ignore param errors
                }
            }
        } catch (err) {
            console.warn("[PdfViewer] toggleAnnotationMode error:", err);
        }
    }

    private applyAnnotationParams(
        tool: "highlight" | "draw" | "text",
        params: { color?: string; thickness?: number }
    ): void {
        if (!this.pdfViewer) return;

        try {
            if (tool === "highlight") {
                if (params.color !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 21, value: params.color }; // INK_COLOR
                }
                if (params.thickness !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 22, value: params.thickness }; // INK_THICKNESS
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorParams = { type: 23, value: 45 }; // INK_OPACITY (translucent)
            } else if (tool === "draw") {
                if (params.color !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 21, value: params.color }; // INK_COLOR
                }
                if (params.thickness !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 22, value: params.thickness }; // INK_THICKNESS
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.pdfViewer as any).annotationEditorParams = { type: 23, value: 100 }; // INK_OPACITY (opaque)
            } else if (tool === "text") {
                if (params.color !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 12, value: params.color }; // FREETEXT_COLOR
                }
                if (params.thickness !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.pdfViewer as any).annotationEditorParams = { type: 11, value: params.thickness }; // FREETEXT_SIZE
                }
            }
        } catch (err) {
            console.warn("[PdfViewer] applyAnnotationParams error:", err);
        }
    }

    private setScrollMode(mode: number): void {
        if (!this.pdfViewer) return;
        this.pdfViewer.scrollMode = mode;
        this.toolbar.setScrollModeState(mode);
        this.forceRender();
    }

    private setSpreadMode(mode: number): void {
        if (!this.pdfViewer) return;
        this.pdfViewer.spreadMode = mode;
        this.toolbar.setSpreadModeState(mode);
        this.forceRender();
    }

    private async printDocument(): Promise<void> {
        if (!this.currentPdfDoc) return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const docAny = this.currentPdfDoc as any;
            const hasAnnotations = docAny.annotationStorage && docAny.annotationStorage.size > 0;
            const data = hasAnnotations && typeof docAny.saveDocument === "function"
                ? await docAny.saveDocument()
                : await this.currentPdfDoc.getData();
            const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);

            const iframe = document.createElement("iframe");
            iframe.style.position = "fixed";
            iframe.style.right = "0";
            iframe.style.bottom = "0";
            iframe.style.width = "0";
            iframe.style.height = "0";
            iframe.style.border = "0";
            iframe.src = url;
            document.body.appendChild(iframe);

            iframe.onload = () => {
                setTimeout(() => {
                    try {
                        iframe.contentWindow?.focus();
                        iframe.contentWindow?.print();
                    } catch {
                        window.open(url, "_blank")?.print();
                    }
                    setTimeout(() => {
                        if (iframe.parentNode) {
                            iframe.parentNode.removeChild(iframe);
                        }
                        URL.revokeObjectURL(url);
                    }, 60000);
                }, 100);
            };
        } catch (err) {
            console.error("[PdfViewer] Print failed:", err);
        }
    }

    private async downloadCurrentPdf(): Promise<void> {
        if (!this.currentPdfDoc) return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const docAny = this.currentPdfDoc as any;
            const hasAnnotations = docAny.annotationStorage && docAny.annotationStorage.size > 0;
            const data = hasAnnotations && typeof docAny.saveDocument === "function"
                ? await docAny.saveDocument()
                : await this.currentPdfDoc.getData();
            const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "document.pdf";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (err) {
            console.error("[PdfViewer] Download failed:", err);
        }
    }

    private showProperties(): void {
        if (!this.currentPdfDoc) return;
        const fileSize = this.currentRawBytes?.byteLength;
        void this.propertiesModal.show(this.currentPdfDoc, fileSize);
    }

    private showViewer(): void {
        this.viewerWrapper.style.display = "flex";
        this.placeholderElement.style.display = "none";
        this.loadingOverlay.style.display = "none";
        this.errorOverlay.style.display = "none";
    }

    private showPlaceholder(): void {
        this.currentAnnotationTool = null;
        this.rootContainer.classList.remove("pdfv-annotating");
        this.placeholderElement.style.display = "flex";
        this.loadingOverlay.style.display = "none";
        this.errorOverlay.style.display = "none";
        this.toolbar.setEnabled(false);
        this.toolbar.setAnnotationToolActive(null);
        this.annotationBar?.hide();
    }

    private showLoading(): void {
        this.placeholderElement.style.display = "none";
        this.loadingOverlay.style.display = "flex";
        this.errorOverlay.style.display = "none";
    }

    private showError(message: string): void {
        this.placeholderElement.style.display = "none";
        this.loadingOverlay.style.display = "none";
        this.errorOverlay.style.display = "flex";
        this.errorMessageElement.textContent = message;
    }

    /**
     * Cheap O(1) fingerprint comparing length and edge samples to detect
     * source changes without cloning 10+ MB strings in memory.
     */
    private calculateFingerprint(source: string): string {
        if (!source) return "";
        const len = source.length;
        const head = source.substring(0, 32);
        const tail = source.substring(Math.max(0, len - 32));
        return `${len}:${head}:${tail}`;
    }

    /**
     * Debounces and queues exporting the edited PDF to base64.
     */
    private queuePdfExport(): void {
        if (this.refreshPdfTimeout !== null) {
            window.clearTimeout(this.refreshPdfTimeout);
        }
        this.refreshPdfTimeout = window.setTimeout(() => {
            this.refreshPdfTimeout = null;
            void this.executePdfExport();
        }, 300);
    }

    private isUserEditingText(): boolean {
        const activeEl = document.activeElement as HTMLElement | null;
        if (!activeEl) return false;
        return (
            this.viewerElement.contains(activeEl) &&
            (activeEl.isContentEditable ||
                activeEl.tagName === "INPUT" ||
                activeEl.tagName === "TEXTAREA" ||
                activeEl.classList.contains("internal"))
        );
    }

    private async executePdfExport(): Promise<void> {
        if (this.isUserEditingText()) {
            this.hasPendingExport = true;
            return;
        }
        if (this.isExportingPdf) {
            this.hasPendingExport = true;
            return;
        }
        this.isExportingPdf = true;
        this.hasPendingExport = false;
        try {
            await this.refreshEditedPdfBase64();
        } finally {
            this.isExportingPdf = false;
            if (this.hasPendingExport && !this.isUserEditingText()) {
                this.hasPendingExport = false;
                void this.executePdfExport();
            }
        }
    }

    /**
     * Serializes the current/edited PDF document with all user annotations (Highlight, Draw, Text, Image/Stamp)
     * and emits the updated Base64 string to the EditedPdf output property.
     */
    private async refreshEditedPdfBase64(): Promise<void> {
        if (!this.currentPdfDoc) {
            this.updateOutputs({ editedPdf: "" });
            return;
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const docAny = this.currentPdfDoc as any;

            // Check if any non-empty annotation editors exist in DOM (highlight, ink, stamp, freetext)
            const editorsInDom = this.viewerElement.querySelectorAll(
                ".annotationEditorLayer :is(.freeTextEditor, .inkEditor, .stampEditor, .highlightEditor)"
            );
            let hasNonEmptyEditorInDom = false;
            for (const ed of Array.from(editorsInDom) as HTMLElement[]) {
                if (ed.classList.contains("freeTextEditor")) {
                    const internal = ed.querySelector(".internal") as HTMLElement | null;
                    if (internal && internal.innerText.trim().length > 0) {
                        hasNonEmptyEditorInDom = true;
                        break;
                    }
                } else {
                    hasNonEmptyEditorInDom = true;
                    break;
                }
            }

            const storageSize = docAny.annotationStorage ? docAny.annotationStorage.size : 0;
            const hasEdits = storageSize > 0 || hasNonEmptyEditorInDom;

            // Serialize document: If annotations exist, use saveDocument() which embeds them into the PDF bytes.
            // Otherwise, get the clean document bytes.
            let data: Uint8Array;
            if (typeof docAny.saveDocument === "function" && hasEdits) {
                data = await docAny.saveDocument();
            } else if (typeof this.currentPdfDoc.getData === "function") {
                data = await this.currentPdfDoc.getData();
            } else if (this.currentRawBytes && this.currentRawBytes.byteLength > 0) {
                data = this.currentRawBytes;
            } else {
                return;
            }

            const base64 = uint8ArrayToBase64(data);
            if (base64) {
                this.updateOutputs({ editedPdf: base64 });
            }
        } catch (err) {
            console.warn("[PdfViewer] Failed to export edited PDF as base64:", err);
            // Fallback: If saveDocument threw, try raw bytes or getData
            try {
                if (this.currentRawBytes && this.currentRawBytes.byteLength > 0) {
                    const fallback = uint8ArrayToBase64(this.currentRawBytes);
                    this.updateOutputs({ editedPdf: fallback });
                } else if (typeof this.currentPdfDoc.getData === "function") {
                    const fallbackData = await this.currentPdfDoc.getData();
                    const fallback = uint8ArrayToBase64(fallbackData);
                    this.updateOutputs({ editedPdf: fallback });
                }
            } catch {
                // Ignore fallback error
            }
        }
    }

    private updateOutputs(changes: {
        loadStatus?: string;
        errorMessage?: string;
        editedPdf?: string;
    }): void {
        let changed = false;

        if (changes.loadStatus !== undefined && this.loadStatus !== changes.loadStatus) {
            this.loadStatus = changes.loadStatus;
            changed = true;
        }
        if (changes.errorMessage !== undefined && this.errorMessage !== changes.errorMessage) {
            this.errorMessage = changes.errorMessage;
            changed = true;
        }
        if (changes.editedPdf !== undefined && this.editedPdfBase64 !== changes.editedPdf) {
            this.editedPdfBase64 = changes.editedPdf;
            changed = true;
        }

        if (changed) {
            this.notifyOutputChanged();
        }
    }
}
