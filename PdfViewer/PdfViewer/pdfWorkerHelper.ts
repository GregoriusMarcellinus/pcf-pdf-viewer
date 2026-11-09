/**
 * pdf.js worker manager.
 * Implements Option 1 (Real Web Worker via persistent Blob URL) with automatic fallback
 * to Option 2 (Main-thread execution) when environment CSP blocks Blob workers.
 */
import { pdfjsLib } from "./pdfBootstrap";
import { PDF_WORKER_CODE } from "./pdfWorkerBundle";

let sharedWorkerBlobUrl: string | null = null;
let isMainThreadWorkerInitialized = false;

/**
 * Initializes the pdf.js worker without requiring any CDN or external network requests.
 * Evaluates Option 1 (Blob URL Worker) first, falling back to Option 2 (Main-thread execution) if blocked.
 * The worker configuration is persistent across control instances and document reloads.
 */
export function ensurePdfWorker(): void {
    // If a valid shared worker blob URL is already active, ensure GlobalWorkerOptions has it
    if (sharedWorkerBlobUrl && pdfjsLib.GlobalWorkerOptions.workerSrc === sharedWorkerBlobUrl) {
        return;
    }

    // If main-thread fallback was already initialized and workerSrc is empty, nothing more to do
    if (isMainThreadWorkerInitialized && pdfjsLib.GlobalWorkerOptions.workerSrc === "") {
        return;
    }

    // Strategy 1: Real Web Worker from a Blob URL
    try {
        if (!sharedWorkerBlobUrl) {
            const blob = new Blob([PDF_WORKER_CODE], { type: "application/javascript" });
            sharedWorkerBlobUrl = URL.createObjectURL(blob);
        }

        // Test if Worker instantiation is allowed by the host page's CSP
        const testWorker = new Worker(sharedWorkerBlobUrl);
        testWorker.terminate();

        pdfjsLib.GlobalWorkerOptions.workerSrc = sharedWorkerBlobUrl;
        console.info("[PdfViewer] Real Web Worker initialized from Blob URL (Option 1).");
        return;
    } catch (err) {
        console.warn(
            "[PdfViewer] Real Web Worker could not be started (CSP restriction). Falling back to main-thread worker (Option 2):",
            err
        );
        if (sharedWorkerBlobUrl) {
            try {
                URL.revokeObjectURL(sharedWorkerBlobUrl);
            } catch {
                // Ignore
            }
            sharedWorkerBlobUrl = null;
        }
    }

    // Strategy 2: Main-thread fallback
    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        const globalTarget = typeof window !== "undefined" ? window : globalThis;
        if (!(globalTarget as unknown as { pdfjsWorker?: unknown }).pdfjsWorker) {
            // Execute worker script once in document context to populate globalThis.pdfjsWorker
            const script = document.createElement("script");
            script.textContent = PDF_WORKER_CODE;
            (document.head || document.documentElement).appendChild(script);
            (document.head || document.documentElement).removeChild(script);
        }
        isMainThreadWorkerInitialized = true;
        console.info("[PdfViewer] Main-thread worker successfully initialized (Option 2 fallback).");
    } catch (fallbackErr) {
        console.error("[PdfViewer] Failed to initialize main-thread worker fallback:", fallbackErr);
    }
}

/**
 * Resets the worker setup and falls back to main-thread execution.
 * Called automatically if a worker error occurs during document loading.
 */
export function resetPdfWorker(): void {
    if (sharedWorkerBlobUrl) {
        try {
            URL.revokeObjectURL(sharedWorkerBlobUrl);
        } catch {
            // Ignore
        }
        sharedWorkerBlobUrl = null;
    }

    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        const globalTarget = typeof window !== "undefined" ? window : globalThis;
        if (!(globalTarget as unknown as { pdfjsWorker?: unknown }).pdfjsWorker) {
            const script = document.createElement("script");
            script.textContent = PDF_WORKER_CODE;
            (document.head || document.documentElement).appendChild(script);
            (document.head || document.documentElement).removeChild(script);
        }
        isMainThreadWorkerInitialized = true;
        console.info("[PdfViewer] Reset to main-thread worker successfully.");
    } catch (err) {
        console.error("[PdfViewer] resetPdfWorker failed:", err);
    }
}

/**
 * Worker cleanup:
 * In SPA environments like Power Apps, the worker is shared across the entire user session.
 * Revoking the worker URL on control destroy breaks subsequent PDF loads when the control remounts.
 * Therefore, the persistent worker reference is maintained for the life of the session.
 */
export function cleanupPdfWorker(): void {
    // Keep shared worker active for session.
}
