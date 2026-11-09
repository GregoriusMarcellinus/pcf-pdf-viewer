# PDF Viewer PCF Control

A production-grade, open-source Power Apps Component Framework (PCF) control for viewing PDF documents in Power Apps Canvas Apps and Model-Driven Apps. Built entirely with Mozilla `pdf.js` (legacy build v3.11.174), it requires zero paid licenses, zero server-side components, and zero external CDN or runtime network dependencies.

---

## 1. Features & Architecture Highlights

- **Base64-First Pipeline**: Robust handling of raw base64, data URIs, surrounding double/single quotes from Power Fx `JSON()`, MIME linebreaks, URL-safe characters (`-`, `_`), and missing padding (`=`).
- **Large File Ready**: Chunked `atob` $\rightarrow$ `Uint8Array` decoding safely supports 10+ MB payloads without browser call-stack overflow or out-of-memory crashes.
- **Embedded Web Worker (Option 1 with Auto-Fallback to Option 2)**:
  - Generates the complete `pdf.worker.min.js` inside the PCF bundle at build time.
  - Instantiates a real Web Worker via a Blob URL (`URL.createObjectURL`) for responsive off-thread parsing.
  - Automatically detects host CSP restrictions: if the Web Worker fails to start, it logs a clear console warning and executes seamlessly on the main thread without crashing.
- **Continuous Scrolling & Text Selection**: Uses Mozilla's official `PDFViewer`, `EventBus`, and `PDFLinkService` from `pdfjs-dist/legacy/web/pdf_viewer` with continuous page layout, smooth zoom scaling, and a fully selectable text layer.
- **Accessible HTML Toolbar**: Includes previous/next page navigation, page number jump input ("X / Y"), zoom in/out, fit width, fit page, custom scale presets, and a one-click PDF download button. All controls feature keyboard accessibility and `aria-label` attributes.
- **Responsive Layout**: Responds dynamically to container resize events via `trackContainerResize(true)` and `ResizeObserver`, re-fitting responsive zoom modes (`page-width`, `page-fit`, `auto`).

---

## 2. Properties Reference

### Input Properties

| Property | Type | Usage | Default | Description |
|---|---|---|---|---|
| `PdfSource` | Multiple | bound | *(Required)* | Primary PDF source: Base64 string, data URI (`data:application/pdf;base64,...`), absolute URL (`http(s)://`), or relative Dataverse Web API path (`/api/data/...`). |
| `Zoom` | SingleLine.Text | input | `page-width` | Zoom preset (`page-width`, `page-fit`, `auto`) or numeric scale factor (e.g. `1.25`, `1.5`). |
| `GoToPage` | Whole.None | input | `none` | Jump to a target page number dynamically when this value changes. |
| `Password` | SingleLine.Text | input | `""` | Password for encrypted/password-protected PDFs. |
| `ShowToolbar` | TwoOptions | input | `true` | Show or hide the top navigation and zoom toolbar. |
| `AllowDownload` | TwoOptions | input | `true` | Show or hide the PDF download button in the toolbar. |

### Output Properties

| Property | Type | Usage | Description |
|---|---|---|---|
| `CurrentPage` | Whole.None | output | The currently visible page number in the viewport. |
| `TotalPages` | Whole.None | output | Total number of pages in the loaded document. |
| `LoadStatus` | SingleLine.Text | output | Current lifecycle status: `Idle`, `Loading`, `Loaded`, or `Error`. |
| `ErrorMessage` | SingleLine.Text | output | Human-readable error description if loading fails; empty when successful. |

---

## 3. Supported Input Formats

1. **Raw Base64**:
   `JVBERi0xLjQKMSAwIG9iai...`
2. **Data URI**:
   `data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iai...`
3. **Quoted Data URI** (emitted by Power Fx `JSON`):
   `"data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iai..."`
4. **MIME Base64**: Base64 strings containing internal whitespace, `\r\n` linebreaks, or tabs.
5. **URL-Safe Base64**: Base64 containing `-` and `_` instead of `+` and `/`.
6. **Unpadded Base64**: Base64 strings with omitted trailing `=` padding.
7. **Absolute Web URL**: `https://example.com/document.pdf` *(Note: subject to browser CORS and host authentication)*.
8. **Dataverse Web API Path**: `/api/data/v9.2/annotations(<guid>)/documentbody/$value` *(fetched with `credentials: 'same-origin'`)*.

---

## 4. Power Fx Recipes for Canvas Apps

### Example 1: Binding Base64 from Power Automate Flow ("Get file content")

When a flow retrieves a PDF from SharePoint, OneDrive, or an HTTP call using the **Get file content** action, return the content bytes as a base64 string to Power Apps:

```powerfx
// On a button click or screen OnVisible:
UpdateContext({
    varPdfContent: 'GetPdfFlow'.Run(locDocumentId).filecontentbase64
});

// In the PDF Viewer Control property:
PdfViewer1.PdfSource = varPdfContent
```

### Example 2: Binding an Attachment or Image Control via `JSON()`

Power Fx `JSON(..., JSONFormat.IncludeBinaryData)` converts files and attachments into a data URI. Notice that `JSON()` wraps the resulting string in double quotes (`"data:application/pdf;base64,..."`), which this control automatically strips and handles:

```powerfx
// When using an Attachment control:
PdfViewer1.PdfSource = JSON(
    First(AttachmentControl.Attachments).Value,
    JSONFormat.IncludeBinaryData
)

// When selecting a file via an Add Media / File input control:
PdfViewer1.PdfSource = JSON(
    UploadedFileControl.Media,
    JSONFormat.IncludeBinaryData
)
```

### Example 3: Binding a Dataverse Attachment / Note (Annotation)

```powerfx
// Using Dataverse Web API path:
PdfViewer1.PdfSource = "/api/data/v9.2/annotations(" & LookUp(Notes, Title = "Invoice.pdf").AnnotationId & ")/documentbody/$value"
```

### Example 4: Utilizing Output Properties in Canvas UI Logic

Use `LoadStatus`, `CurrentPage`, `TotalPages`, and `ErrorMessage` to power your Canvas app UI:

```powerfx
// Page Progress Label:
LabelPageIndicator.Text = "Page " & PdfViewer1.CurrentPage & " of " & PdfViewer1.TotalPages

// Conditional Status / Spinner display:
SpinnerLoading.Visible = (PdfViewer1.LoadStatus = "Loading")

// Error Notification Banner:
ErrorBanner.Visible = (PdfViewer1.LoadStatus = "Error")
ErrorBannerText.Text = PdfViewer1.ErrorMessage

// Next / Previous buttons external to the control:
BtnPrevPage.DisplayMode = If(PdfViewer1.CurrentPage > 1, DisplayMode.Edit, DisplayMode.Disabled)
BtnNextPage.DisplayMode = If(PdfViewer1.CurrentPage < PdfViewer1.TotalPages, DisplayMode.Edit, DisplayMode.Disabled)
```

### Important Note: Canvas Text-Size Limits & Large Files

> [!WARNING]
> While this PCF control's chunked decoding engine can easily handle 10+ MB payloads, the Power Apps Canvas runtime may experience performance degradation or memory limits when storing very large strings (typically 20–30+ MB) in local variable memory (`UpdateContext` or `Set`).
>
> For files larger than 15 MB, it is strongly recommended to:
> 1. Pass a direct download URL or Dataverse Web API path (`/api/data/...`) directly to `PdfSource`.
> 2. Have your Power Automate flow generate a temporary SAS URL or authenticated direct link rather than streaming raw base64 through the Canvas app memory layer.

---

## 5. Local Testing with PCF Test Harness

### Running the Test Harness
Run the watch task in your terminal:
```powershell
npm run start:watch
```
This automatically compiles the control and opens the local test harness in your browser (`http://localhost:8181`).

### Testing with the Sample Base64 PDF
A valid test fixture file `sample-base64.txt` has been provided in the project root.

1. Open `sample-base64.txt`.
2. Copy any of the test strings:
   - **Case 1 (Raw Base64)**: Paste directly into the `PdfSource` input field in the test harness properties pane.
   - **Case 2 (Data URI)**: Paste `data:application/pdf;base64,...` into `PdfSource`.
   - **Case 3 (Quoted Data URI)**: Paste `"data:application/pdf;base64,..."` into `PdfSource`.
3. Press Tab or Enter to update.
4. The test PDF will immediately render with page controls, zoom controls, and selectable text.

To re-generate the test fixture script at any time:
```powershell
node scripts/generate-sample-pdf.js
```

---

## 6. Build & Packaging Commands

### Build Commands

```powershell
# Standard development build (with prebuild asset generation):
npm run build

# Production optimized build (minified bundle):
npm run build -- --buildMode production
```

### Deploying to Your Power Platform Environment

> [!NOTE]
> Ensure you have authenticated using the Power Platform CLI before deploying:
> ```powershell
> pac auth create --environment <YourEnvironmentUrl>
> ```

To push the control directly to your active development Dataverse environment:
```powershell
pac pcf push --publisher-prefix contoso
```
*(Replace `contoso` with your custom solution publisher prefix).*

---

## 7. Architectural Decisions & Technical Summary

1. **Worker Strategy (Option 1 with Option 2 Fallback)**:
   - The worker script (`pdf.worker.min.js`) is packaged directly into a TypeScript module during the `prebuild` step (`scripts/prepare-assets.js`).
   - At runtime, `URL.createObjectURL(new Blob(...))` spins up a real Web Worker.
   - If the host environment's Content Security Policy (CSP) restricts `blob:` workers, `testWorker = new Worker(...)` catches the security error and automatically falls back to main-thread execution (`globalThis.pdfjsWorker`).
2. **Renderer Approach**:
   - Built on Mozilla's official `pdfjs-dist/legacy/web/pdf_viewer` component architecture (`PDFViewer`, `EventBus`, `PDFLinkService`).
   - Enables continuous multi-page scrolling, real DOM text selection, annotation support, and zoom management.
   - Toolbar is built with lightweight, accessible semantic HTML/CSS without the bulky, hardcoded `viewer.html` shell.
3. **Asset Isolation & Styling**:
   - `pdf_viewer.css` is extracted, sanitized of missing/relative `url(...)` declarations, and registered via `<css>` in `ControlManifest.Input.xml`.
   - All custom styles use the `.pdfv-` namespace to prevent CSS collisions with host Power Apps styles.
