(function() {
        if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        // ===== STATE =====
        let state = {
            recordId: null,
            fileData: null,
            fileRasterDataUrl: null,
            fileName: '',
            fileType: '',
            fileKind: '',
            studentName: '',
            studentId: '',
            major: '',
            yearFrom: '',
            yearTo: '',
            academicYear: '',
            verifyDate: '',
            signatureData: null,
            stampData: null,
            finalImageData: null
        };

        // ===== DOM REFS =====
        const $ = id => document.getElementById(id);
        const step1 = $('step1');
        const step2 = $('step2');
        const step3 = $('step3');
        const fileInput = $('fileInput');
        const extractBtn = $('extractBtn');
        const uploadBtn = $('uploadBtn');
        const previewBox = $('previewBox');
        const previewName = $('previewName');
        const previewId = $('previewId');
        const previewMajor = $('previewMajor');
        const previewYear = $('previewYear');
        const previewDate = $('previewDate');
        const filePreviewContainer = $('filePreviewContainer');
        const confirmInfoBtn = $('confirmInfoBtn');
        const signatureInput = $('signatureInput');
        const stampInput = $('stampInput');
        const signaturePreview = $('signaturePreview');
        const stampPreview = $('stampPreview');
        const confirmSignatureBtn = $('confirmSignatureBtn');
        const previewWithSignatures = $('previewWithSignatures');
        const finalContent = $('finalContent');
        const downloadPdfBtn = $('downloadPdfBtn');
        const resetBtn = $('resetBtn');
        const qrContainer = $('qrcode');
        const loadingOverlay = $('loadingOverlay');
        const loadingText = $('loadingText');
        const ocrResult = $('ocrResult');
        const ocrText = $('ocrText');
        const extractedInfo = $('extractedInfo');
        const extractedData = $('extractedData');
        const sigPositionX = $('sigPositionX');
        const sigPositionY = $('sigPositionY');
        const stampPositionX = $('stampPositionX');
        const stampPositionY = $('stampPositionY');
        const sigSize = $('sigSize');
        const stampSize = $('stampSize');
        const sigSizeLabel = $('sigSizeLabel');
        const stampSizeLabel = $('stampSizeLabel');
        const verifyDateInput = $('verifyDate');
        const dateIcon = $('dateIcon');
        const yearFrom = $('yearFrom');
        const yearTo = $('yearTo');

        sigSize.addEventListener('input', () => sigSizeLabel.textContent = sigSize.value + 'px');
        stampSize.addEventListener('input', () => stampSizeLabel.textContent = stampSize.value + 'px');

        function persistRecords(records) {
            try {
                localStorage.setItem('universityDB', JSON.stringify(records));
                return true;
            } catch {
                showToast('ذخیره نشد؛ فضای مرورگر پر است یا دسترسی ذخیره‌سازی بسته است. فایل اصلی را نگه دارید.', '#c0392b');
                return false;
            }
        }
        function readRecords() {
            try {
                const records = JSON.parse(localStorage.getItem('universityDB') || '[]');
                if (!Array.isArray(records)) throw new Error('Invalid record list');
                return records;
            } catch {
                showToast('سوابق مرورگر قابل خواندن نیست. برای جلوگیری از بازنویسی اطلاعات، ذخیره متوقف شد.', '#c0392b');
                return null;
            }
        }
        function validateFile(file, imageOnly = false) {
            if (file.size > 8 * 1024 * 1024) throw new Error('حجم فایل باید کمتر از ۸ مگابایت باشد.');
            if (imageOnly && !/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
                throw new Error('برای امضا و مهر یک تصویر PNG، JPG یا WebP انتخاب کنید.');
            }
        }
        fileInput.addEventListener('change', () => {
            state.fileData = null;
            state.fileRasterDataUrl = null;
            state.finalImageData = null;
            state.recordId = null;
            previewBox.classList.remove('active');
            ocrResult.classList.remove('active');
            extractedInfo.classList.remove('active');
        });
        [sigPositionX, sigPositionY, stampPositionX, stampPositionY, sigSize, stampSize].forEach(input => {
            input.addEventListener('input', () => { state.finalImageData = null; });
        });

        // ===== TOAST =====
        function escapeHtml(value) {
            const el = document.createElement('span');
            el.textContent = String(value);
            return el.innerHTML;
        }

        function showToast(msg, color = '#2c3e50') {
            const old = document.querySelector('.toast');
            if (old) old.remove();
            const div = document.createElement('div');
            div.className = 'toast';
            div.setAttribute('role', 'status');
            div.style.background = color;
            div.textContent = msg;
            document.body.appendChild(div);
            setTimeout(() => div.remove(), 3500);
        }

        // ===== LOADING =====
        function showLoading(text = 'در حال پردازش...') {
            loadingText.textContent = text;
            loadingOverlay.classList.add('active');
        }

        function hideLoading() {
            loadingOverlay.classList.remove('active');
        }

        // ===== HELPERS =====
        function readFileAsDataURL(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }


        async function readFileHeader(file, length = 16) {
            const blob = file.slice(0, length);
            const buf = await blob.arrayBuffer();
            return new Uint8Array(buf);
        }

        function matchesSignature(bytes, sig, offset = 0) {
            for (let i = 0; i < sig.length; i++) {
                if (bytes[offset + i] !== sig[i]) return false;
            }
            return true;
        }

        async function detectFileKind(file) {
            try {
                const bytes = await readFileHeader(file, 16);
                if (matchesSignature(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', reason: 'magic' };   // %PDF
                if (matchesSignature(bytes, [0xFF, 0xD8, 0xFF])) return { kind: 'image', reason: 'magic' };        // JPEG
                if (matchesSignature(bytes, [0x89, 0x50, 0x4E, 0x47])) return { kind: 'image', reason: 'magic' };  // PNG
                if (matchesSignature(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: 'image', reason: 'magic' };  // GIF
                if (matchesSignature(bytes, [0x42, 0x4D])) return { kind: 'image', reason: 'magic' };              // BMP
                if (matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46]) && matchesSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
                    return { kind: 'image', reason: 'magic' }; // WEBP (RIFF....WEBP)
                }
            } catch (e) {
                // fall through to mime/extension based detection below
            }

            if (file.type === 'application/pdf') return { kind: 'pdf', reason: 'mime' };
            if (file.type && file.type.startsWith('image/')) return { kind: 'image', reason: 'mime' };

            const ext = (file.name.split('.').pop() || '').toLowerCase();
            if (ext === 'pdf') return { kind: 'pdf', reason: 'extension' };
            if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return { kind: 'image', reason: 'extension' };

            return { kind: 'unknown', reason: 'none' };
        }

        function isImageFile() { return state.fileKind === 'image'; }
        function isPDFFile() { return state.fileKind === 'pdf'; }

        // ===== EXTRACT TEXT =====

        async function extractTextAndRasterFromPDF(pdfDataUrl) {
            showLoading('در حال بارگذاری PDF...');
            const response = await fetch(pdfDataUrl);
            const arrayBuffer = await response.arrayBuffer();
            if (!window.pdfjsLib) throw new Error('کتابخانه PDF بارگذاری نشده است. اتصال اینترنت را بررسی کنید.');
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            if (pdf.numPages !== 1) {
                await pdf.destroy();
                throw new Error('این نسخه فقط مدرک تک‌صفحه‌ای را پردازش می‌کند. فایل چندصفحه‌ای بدون تغییر باقی ماند.');
            }
            const page = await pdf.getPage(1);

            let directText = '';
            try {
                const textContent = await page.getTextContent();
                directText = textContent.items.map(item => item.str).join(' ');
            } catch (e) { /* ignore, we'll OCR instead */ }

            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const rasterDataUrl = canvas.toDataURL('image/png');
            await pdf.destroy();

            let text = directText;
            if (!directText || directText.replace(/\s/g, '').length < 20) {
                text = await ocrCanvas(canvas); // scanned PDF, no real text layer
            } else {
                hideLoading();
            }

            return { text, rasterDataUrl };
        }


        async function ocrCanvas(canvasOrImage) {
            showLoading('در حال تشخیص متن (OCR)...');
            const worker = await Tesseract.createWorker('fas', 1, {
                logger: m => {
                    if (m.status === 'recognizing text' && typeof m.progress === 'number') {
                        loadingText.textContent = `در حال تشخیص متن: ${Math.round(m.progress * 100)}%`;
                    }
                }
            });
            try {
                const { data } = await worker.recognize(canvasOrImage);
                return data.text || '';
            } finally {
                await worker.terminate();
                hideLoading();
            }
        }

        async function extractTextFromImage(imageDataUrl) {
            try {
                return await ocrCanvas(imageDataUrl);
            } catch (error) {
                console.error('OCR Error:', error);
                hideLoading();
                showToast('خطا در تشخیص متن: ' + error.message, '#e74c3c');
                return '';
            }
        }

        function parseExtractedText(text) {
            if (!text) return null;

            let name = '';
            let studentId = '';
            let major = '';
            let yearFromVal = '';
            let yearToVal = '';
            let date = '';

            const patterns = {
                studentId: [
                    /شماره\s*دانشجویی[\s:]*([^\s]+)/,
                    /دانشجویی[\s:]*([^\s]+)/,
                    /([۰-۹0-9]{10,16})/
                ],
                name: [
                    /نام(?:\s*و\s*نام\s*خانوادگی)?[\s:]+([^\n:]+)/
                ],
                yearFrom: [
                    /از\s*سال[\s:]*([^\s]+)/,
                    /([۰-۹0-9]{4})\s*-\s*([۰-۹0-9]{4})/
                ],
                yearTo: [
                    /تا\s*سال[\s:]*([^\s]+)/
                ],
                date: [
                    /تاریخ\s*تایید[\s:]*([^\s]+)/,
                    /([۰-۹0-9]{4}\/[۰-۹0-9]{1,2}\/[۰-۹0-9]{1,2})/
                ],
                major: [
                    /مهندسی\s*(?:عمران|کامپیوتر|برق|مکانیک)/,
                    /(عمران|کامپیوتر|برق|مکانیک|صنایع)/
                ]
            };

            const yearRangeMatch = text.match(/([۰-۹0-9]{4})\s*[-–]\s*([۰-۹0-9]{4})/);
            if (yearRangeMatch) {
                yearFromVal = yearRangeMatch[1].trim();
                yearToVal = yearRangeMatch[2].trim();
            }

            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

            for (const line of lines) {
                if (!studentId) {
                    for (const pattern of patterns.studentId) {
                        const match = line.match(pattern);
                        if (match && match[1]) { studentId = match[1].trim(); break; }
                    }
                }
                if (!name) {
                    for (const pattern of patterns.name) {
                        const match = line.match(pattern);
                        if (match && match[1]) { name = match[1].trim(); break; }
                    }
                }
                if (!yearFromVal) {
                    for (const pattern of patterns.yearFrom) {
                        const match = line.match(pattern);
                        if (match && match[1]) { yearFromVal = match[1].trim(); break; }
                    }
                }
                if (!yearToVal) {
                    for (const pattern of patterns.yearTo) {
                        const match = line.match(pattern);
                        if (match && match[1]) { yearToVal = match[1].trim(); break; }
                    }
                }
                if (!date) {
                    for (const pattern of patterns.date) {
                        const match = line.match(pattern);
                        if (match && match[1]) { date = match[1].trim(); break; }
                    }
                }
                if (!major) {
                    for (const pattern of patterns.major) {
                        const match = line.match(pattern);
                        if (match) { major = match[0].trim(); break; }
                    }
                }
            }

            if (!major && text.includes('عمران')) major = 'مهندسی عمران';

            return { name, studentId, major, yearFrom: yearFromVal, yearTo: yearToVal, date };
        }

        // ===== EXTRACT BUTTON =====
        extractBtn.addEventListener('click', async function() {
            const file = fileInput.files[0];
            if (!file) {
                showToast('لطفاً ابتدا یک فایل انتخاب کنید.', '#e74c3c');
                return;
            }

            try {
                validateFile(file);
                const detection = await detectFileKind(file);
                if (detection.kind === 'unknown') {
                    showToast('نوع فایل شناسایی نشد. لطفاً یک فایل PDF یا عکس (JPG/PNG) بارگذاری کنید.', '#e74c3c');
                    return;
                }

                const base64 = await readFileAsDataURL(file);
                state.fileData = base64;
                state.fileName = file.name;
                state.fileKind = detection.kind;
                state.fileType = detection.kind === 'pdf' ? 'application/pdf' : (file.type || 'image/*');

                let extractedText = '';

                if (detection.kind === 'pdf') {
                    const result = await extractTextAndRasterFromPDF(base64);
                    extractedText = result.text;
                    state.fileRasterDataUrl = result.rasterDataUrl;
                } else {
                    state.fileRasterDataUrl = base64;
                    extractedText = await extractTextFromImage(base64);
                }

                ocrText.textContent = extractedText || 'متنی تشخیص داده نشد.';
                ocrResult.classList.add('active');

                const parsed = parseExtractedText(extractedText);

                if (parsed) {
                    let infoHTML = '';
                    if (parsed.name) {
                        infoHTML += `<div><strong>نام:</strong> ${escapeHtml(parsed.name)}</div>`;
                        $('studentName').value = parsed.name;
                    }
                    if (parsed.studentId) {
                        infoHTML += `<div><strong>شماره دانشجویی:</strong> ${escapeHtml(parsed.studentId)}</div>`;
                        $('studentId').value = parsed.studentId;
                    }
                    if (parsed.major) {
                        infoHTML += `<div><strong>رشته:</strong> ${escapeHtml(parsed.major)}</div>`;
                        $('major').value = parsed.major;
                    }
                    if (parsed.yearFrom) {
                        infoHTML += `<div><strong>سال شروع:</strong> ${escapeHtml(parsed.yearFrom)}</div>`;
                        yearFrom.value = parsed.yearFrom;
                    }
                    if (parsed.yearTo) {
                        infoHTML += `<div><strong>سال پایان:</strong> ${escapeHtml(parsed.yearTo)}</div>`;
                        yearTo.value = parsed.yearTo;
                    }
                    if (parsed.date) {
                        infoHTML += `<div><strong>تاریخ تایید:</strong> ${escapeHtml(parsed.date)}</div>`;
                        verifyDateInput.value = parsed.date;
                    }

                    if (infoHTML) {
                        extractedData.innerHTML = infoHTML;
                        extractedInfo.classList.add('active');
                        showToast('اطلاعات با موفقیت استخراج شد!', '#27ae60');
                    } else {
                        showToast('اطلاعات ساختاری پیدا نشد. لطفاً دستی وارد کنید.', '#f39c12');
                    }
                } else {
                    showToast('متنی تشخیص داده شد اما اطلاعات پیدا نشد.', '#f39c12');
                }

            } catch (err) {
                console.error('Extraction error:', err);
                hideLoading();
                showToast('خطا: ' + err.message, '#e74c3c');
            }
        });

        // ===== PREVIEW =====
        uploadBtn.addEventListener('click', async function() {
            const name = $('studentName').value.trim();
            const id = $('studentId').value.trim();
            const major = $('major').value.trim();
            const yearFromVal = yearFrom.value.trim();
            const yearToVal = yearTo.value.trim();
            const date = verifyDateInput.value.trim();
            const file = fileInput.files[0];

            if (!name || !id || !major || !yearFromVal || !yearToVal || !date) {
                showToast('لطفاً تمام فیلدها را پر کنید.', '#e74c3c');
                return;
            }

            if (!state.fileData && file) {
                try {
                    validateFile(file);
                const detection = await detectFileKind(file);
                    if (detection.kind === 'unknown') {
                        showToast('نوع فایل شناسایی نشد. لطفاً یک فایل PDF یا عکس (JPG/PNG) بارگذاری کنید.', '#e74c3c');
                        return;
                    }
                    state.fileKind = detection.kind;
                    state.fileData = await readFileAsDataURL(file);
                    state.fileName = file.name;
                    state.fileType = detection.kind === 'pdf' ? 'application/pdf' : (file.type || 'image/*');

                    if (detection.kind === 'pdf') {
                        const result = await extractTextAndRasterFromPDF(state.fileData);
                        state.fileRasterDataUrl = result.rasterDataUrl;
                        hideLoading();
                    } else {
                        state.fileRasterDataUrl = state.fileData;
                    }
                } catch (err) {
                    hideLoading();
                    showToast('خطا در خواندن فایل: ' + err.message, '#e74c3c');
                    return;
                }
            }

            if (!state.fileData) {
                showToast('لطفاً یک فایل انتخاب کنید.', '#e74c3c');
                return;
            }

            state.studentName = name;
            state.studentId = id;
            state.major = major;
            state.yearFrom = yearFromVal;
            state.yearTo = yearToVal;
            state.academicYear = `${yearFromVal} - ${yearToVal}`;
            state.verifyDate = date;

            previewName.textContent = name;
            previewId.textContent = id;
            previewMajor.textContent = major;
            previewYear.textContent = `${yearFromVal} - ${yearToVal}`;
            previewDate.textContent = date;

            filePreviewContainer.innerHTML = '';
            const badge = document.createElement('div');
            if (isImageFile()) {
                badge.className = 'file-kind-badge kind-image';
                badge.textContent = 'نوع فایل: تصویر';
                filePreviewContainer.appendChild(badge);
                const img = document.createElement('img');
                img.src = state.fileData;
                img.alt = 'پیش‌نمایش';
                filePreviewContainer.appendChild(img);
            } else if (isPDFFile()) {
                badge.className = 'file-kind-badge kind-pdf';
                badge.textContent = 'نوع فایل: PDF';
                filePreviewContainer.appendChild(badge);
                const iframe = document.createElement('iframe');
                iframe.title = 'پیش‌نمایش فایل PDF';
                iframe.src = state.fileData;
                filePreviewContainer.appendChild(iframe);
            } else {
                badge.className = 'file-kind-badge kind-unknown';
                badge.textContent = 'نوع فایل نامشخص';
                filePreviewContainer.appendChild(badge);
            }

            previewBox.classList.add('active');
            showToast('اطلاعات با موفقیت بارگذاری شد.', '#27ae60');
        });

        // ===== CONFIRM INFO =====
        confirmInfoBtn.addEventListener('click', function() {
            if (!state.fileData) {
                showToast('ابتدا فایل را بارگذاری کنید.', '#e74c3c');
                return;
            }

            state.recordId ||= crypto.randomUUID();
            const record = {
                recordId: state.recordId,
                name: state.studentName,
                id: state.studentId,
                major: state.major,
                yearFrom: state.yearFrom,
                yearTo: state.yearTo,
                academicYear: state.academicYear,
                date: state.verifyDate,
                file: state.fileData,
                fileName: state.fileName,
                fileType: state.fileType,
                fileKind: state.fileKind,
                timestamp: new Date().toISOString()
            };

            const db = readRecords();
            if (!db) return;
            const existing = db.findIndex(item => item.recordId === state.recordId);
            if (existing >= 0) db[existing] = record;
            else db.push(record);
            if (!persistRecords(db)) return;

            showToast('اطلاعات ذخیره شد.', '#27ae60');

            step1.style.display = 'none';
            step2.classList.remove('hidden');
            step3.classList.add('hidden');

            if (state.signatureData) {
                signaturePreview.innerHTML = `<img src="${state.signatureData}" style="max-width:100%;max-height:100px;">`;
            }
            if (state.stampData) {
                stampPreview.innerHTML = `<img src="${state.stampData}" style="max-width:100%;max-height:100px;">`;
            }
        });

        // ===== SIGNATURE & STAMP =====
        signatureInput.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            try {
                validateFile(file, true);
                const base64 = await readFileAsDataURL(file);
                state.finalImageData = null;
                state.signatureData = base64;
                signaturePreview.innerHTML = `<img src="${base64}" style="max-width:100%;max-height:100px;">`;
                showToast('امضا بارگذاری شد.', '#3498db');
            } catch (err) {
                showToast('خطا: ' + err.message, '#e74c3c');
            }
        });

        stampInput.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            try {
                validateFile(file, true);
                const base64 = await readFileAsDataURL(file);
                state.finalImageData = null;
                state.stampData = base64;
                stampPreview.innerHTML = `<img src="${base64}" style="max-width:100%;max-height:100px;">`;
                showToast('مهر بارگذاری شد.', '#3498db');
            } catch (err) {
                showToast('خطا: ' + err.message, '#e74c3c');
            }
        });

        // ===== GENERATE QR CODE =====

        function generateQRCodeDataURL(size = 150) {
            return new Promise((resolve) => {
                const hiddenHost = document.createElement('div');
                hiddenHost.style.position = 'fixed';
                hiddenHost.style.left = '-9999px';
                hiddenHost.style.top = '-9999px';
                document.body.appendChild(hiddenHost);

                const shortText = `ID:${(state.studentId || '').substring(0, 12)}`;

                try {
                    new QRCode(hiddenHost, {
                        text: shortText,
                        width: size,
                        height: size,
                        colorDark: '#2c3e50',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.L
                    });
                } catch (e) {
                    console.warn('QR Code error, using fallback', e);
                    document.body.removeChild(hiddenHost);
                    const canvas = document.createElement('canvas');
                    canvas.width = size; canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, size, size);
                    ctx.fillStyle = '#2c3e50';
                    ctx.font = 'bold 14px Tahoma';
                    ctx.textAlign = 'center';
                    ctx.fillText(state.studentId || '---', size / 2, size / 2);
                    resolve(canvas.toDataURL('image/png'));
                    return;
                }

                setTimeout(() => {
                    const innerCanvas = hiddenHost.querySelector('canvas');
                    let dataUrl = '';
                    if (innerCanvas) {
                        dataUrl = innerCanvas.toDataURL('image/png');
                    } else {
                        const innerImg = hiddenHost.querySelector('img');
                        dataUrl = innerImg ? innerImg.src : '';
                    }
                    document.body.removeChild(hiddenHost);
                    resolve(dataUrl);
                }, 250);
            });
        }

        // ===== REMOVE WHITE BACKGROUND =====
        function removeWhiteBackground(image) {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 235 && data[i+1] > 235 && data[i+2] > 235) {
                    data[i+3] = 0;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            return canvas;
        }

        // ===== APPLY SIGNATURES TO IMAGE =====
        function applySignaturesToImage(imageDataUrl, sigData, stampData, qrData) {
            return new Promise((resolve, reject) => {
                try {
                    const img = new Image();
                    img.onload = function() {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');

                        ctx.drawImage(img, 0, 0);

                        let loadedCount = 0;
                        const totalImages = 3;

                        function checkComplete() {
                            loadedCount++;
                            if (loadedCount === totalImages) {
                                resolve(canvas.toDataURL('image/png'));
                            }
                        }

                        const sigImg = new Image();
                        sigImg.onload = function() {
                            const sigW = parseInt(sigSize.value) || 130;
                            const sigH = sigImg.height * (sigW / sigImg.width);
                            const sigX = (img.width * (parseInt(sigPositionX.value) / 100)) - sigW / 2;
                            const sigY = (img.height * (parseInt(sigPositionY.value) / 100)) - sigH / 2;
                            ctx.globalAlpha = 0.9;
                            // ---- FIX: remove white background from signature ----
                            const cleanSig = removeWhiteBackground(sigImg);
                            ctx.drawImage(cleanSig, sigX, sigY, sigW, sigH);
                            checkComplete();
                        };
                        sigImg.onerror = checkComplete;
                        sigImg.src = sigData;

                        const stampImg = new Image();
                        stampImg.onload = function() {
                            const stampW = parseInt(stampSize.value) || 110;
                            const stampH = stampImg.height * (stampW / stampImg.width);
                            const stampX = (img.width * (parseInt(stampPositionX.value) / 100)) - stampW / 2;
                            const stampY = (img.height * (parseInt(stampPositionY.value) / 100)) - stampH / 2;
                            ctx.globalAlpha = 0.85;
                            // ---- FIX: remove white background from stamp ----
                            const cleanStamp = removeWhiteBackground(stampImg);
                            ctx.drawImage(cleanStamp, stampX, stampY, stampW, stampH);
                            checkComplete();
                        };
                        stampImg.onerror = checkComplete;
                        stampImg.src = stampData;

                        const qrImg = new Image();
                        qrImg.onload = function() {
                            // ---- FIX: smaller QR code, placed at bottom-left ----
                            const qrSize = 70;
                            const qrX = 15;
                            const qrY = img.height - qrSize - 15;
                            ctx.globalAlpha = 1;
                            ctx.fillStyle = 'white';
                            ctx.fillRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
                            ctx.strokeStyle = '#2c3e50';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
                            ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
                            checkComplete();
                        };
                        qrImg.onerror = checkComplete;
                        qrImg.src = qrData;
                    };
                    img.onerror = () => reject(new Error('خطا در بارگذاری تصویر مدرک'));
                    img.src = imageDataUrl;
                } catch (err) {
                    reject(err);
                }
            });
        }

        // ===== PREVIEW WITH SIGNATURES =====
        previewWithSignatures.addEventListener('click', async function() {
            if (!state.fileRasterDataUrl) {
                showToast('ابتدا فایل اصلی را بارگذاری کنید.', '#e74c3c');
                return;
            }
            if (!state.signatureData || !state.stampData) {
                showToast('لطفاً هم امضا و هم مهر را بارگذاری کنید.', '#e74c3c');
                return;
            }

            try {
                showLoading('در حال اعمال امضا و مهر...');

                const qrDataUrl = await generateQRCodeDataURL();

                const result = await applySignaturesToImage(
                    state.fileRasterDataUrl,
                    state.signatureData,
                    state.stampData,
                    qrDataUrl
                );
                hideLoading();

                state.finalImageData = result;

                finalContent.innerHTML = '';
                const img = document.createElement('img');
                img.src = result;
                img.style.maxWidth = '100%';
                img.style.borderRadius = '10px';
                img.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
                finalContent.appendChild(img);

                qrContainer.innerHTML = '';
                try {
                    new QRCode(qrContainer, {
                        text: `ID:${(state.studentId || '').substring(0, 12)}`,
                        width: 150,
                        height: 150,
                        colorDark: '#2c3e50',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.L
                    });
                } catch (e) {
                    qrContainer.innerHTML = `<p style="color:#2c3e50;font-size:1.2rem;">${escapeHtml(state.studentId)}</p>`;
                }

                step1.style.display = 'none';
                step2.classList.add('hidden');
                step3.classList.remove('hidden');

                showToast('مدرک با امضا و مهر آماده است!', '#27ae60');
            } catch (err) {
                hideLoading();
                showToast('خطا: ' + err.message, '#e74c3c');
                console.error(err);
            }
        });

        // ===== CONFIRM SIGNATURE =====
        confirmSignatureBtn.addEventListener('click', async function() {
            if (!state.signatureData || !state.stampData) {
                showToast('لطفاً هم امضا و هم مهر را بارگذاری کنید.', '#e74c3c');
                return;
            }

            if (!state.finalImageData) {
                try {
                    showLoading('در حال اعمال امضا و مهر...');
                    const qrDataUrl = await generateQRCodeDataURL();
                    const result = await applySignaturesToImage(
                        state.fileRasterDataUrl,
                        state.signatureData,
                        state.stampData,
                        qrDataUrl
                    );
                    hideLoading();
                    state.finalImageData = result;
                } catch (err) {
                    hideLoading();
                    showToast('خطا: ' + err.message, '#e74c3c');
                    return;
                }
            }

            const db = readRecords();
            if (!db) return;
            const record = db.find(item => item.recordId === state.recordId);
            if (!record) { showToast('رکورد اصلی پیدا نشد؛ ابتدا مدرک را دوباره ثبت کنید.', '#c0392b'); return; }
            record.finalImage = state.finalImageData;
            if (!persistRecords(db)) return;

            showToast('مدرک نهایی با موفقیت ذخیره شد!', '#27ae60');

            finalContent.innerHTML = '';
            const img = document.createElement('img');
            img.src = state.finalImageData;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '10px';
            img.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
            finalContent.appendChild(img);

            step1.style.display = 'none';
            step2.classList.add('hidden');
            step3.classList.remove('hidden');
        });

        // ===== DOWNLOAD PDF =====
        downloadPdfBtn.addEventListener('click', function() {
            const img = finalContent.querySelector('img');
            if (!img || !img.src) {
                showToast('مدرک نهایی موجود نیست.', '#e74c3c');
                return;
            }

            showToast('در حال ساخت PDF...', '#3498db');

            const image = new Image();
            image.onload = function() {
                try {
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF(image.width > image.height ? 'l' : 'p', 'mm', 'a4');
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
                    const width = image.width * scale;
                    const height = image.height * scale;
                    pdf.addImage(image.src, 'PNG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
                    pdf.save(`مدرک_${state.studentId}_${state.studentName}.pdf`);
                    showToast('PDF با موفقیت دانلود شد!', '#27ae60');
                } catch (err) {
                    showToast('خطا: ' + err.message, '#e74c3c');
                }
            };
            image.onerror = () => showToast('تصویر مدرک قابل خواندن نیست.', '#c0392b');
            image.src = img.src;
        });

        // ===== RESET =====
        resetBtn.addEventListener('click', function() {
            state.recordId = null;
            state.fileData = null;
            state.fileRasterDataUrl = null;
            state.fileName = '';
            state.fileType = '';
            state.fileKind = '';
            state.signatureData = null;
            state.stampData = null;
            state.finalImageData = null;

            fileInput.value = '';
            signatureInput.value = '';
            stampInput.value = '';
            signaturePreview.innerHTML = '';
            stampPreview.innerHTML = '';
            previewBox.classList.remove('active');
            filePreviewContainer.innerHTML = '';
            finalContent.innerHTML = '';
            qrContainer.innerHTML = '';
            ocrResult.classList.remove('active');
            ocrText.textContent = '';
            extractedInfo.classList.remove('active');
            extractedData.innerHTML = '';

            step1.style.display = 'block';
            step2.classList.add('hidden');
            step3.classList.add('hidden');

            $('studentName').value = '';
            $('studentId').value = '';
            $('major').value = '';
            yearFrom.value = '';
            yearTo.value = '';
            verifyDateInput.value = '';

            showToast('حالت بازنشانی شد.', '#f39c12');
        });



        function div(a, b) { return ~~(a / b); }
        function mod(a, b) { return a - ~~(a / b) * b; }

        function jalCal(jy) {
            const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
            const bl = breaks.length;
            const gy = jy + 621;
            let leapJ = -14, jp = breaks[0], jm, jump, n, leap, i;
            if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سال شمسی نامعتبر: ' + jy);
            for (i = 1; i < bl; i += 1) {
                jm = breaks[i];
                jump = jm - jp;
                if (jy < jm) break;
                leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
                jp = jm;
            }
            n = jy - jp;
            leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
            if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
            const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
            const march = 20 + leapJ - leapG;
            if (jump - n < 6) n = n - jump + div(jump, 33) * 33;
            leap = mod(mod(n + 1, 33) - 1, 4);
            if (leap === -1) leap = 4;
            return { leap: leap, gy: gy, march: march };
        }

        function g2d(gy, gm, gd) {
            let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
                + div(153 * mod(gm + 9, 12) + 2, 5)
                + gd - 34840408;
            d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
            return d;
        }

        function d2g(jdn) {
            let j = 4 * jdn + 139361631;
            j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
            const i = div(mod(j, 1461), 4) * 5 + 308;
            const gd = div(mod(i, 153), 5) + 1;
            const gm = mod(div(i, 153), 12) + 1;
            const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
            return { gy: gy, gm: gm, gd: gd };
        }

        function j2d(jy, jm, jd) {
            const r = jalCal(jy);
            return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
        }

        function d2j(jdn) {
            const gy = d2g(jdn).gy;
            let jy = gy - 621;
            const r = jalCal(jy);
            const jdn1f = g2d(gy, 3, r.march);
            let k = jdn - jdn1f, jm, jd;
            if (k >= 0) {
                if (k <= 185) {
                    jm = 1 + div(k, 31);
                    jd = mod(k, 31) + 1;
                    return { jy: jy, jm: jm, jd: jd };
                } else {
                    k -= 186;
                }
            } else {
                jy -= 1;
                k += 179;
                if (r.leap === 1) k += 1;
            }
            jm = 7 + div(k, 30);
            jd = mod(k, 30) + 1;
            return { jy: jy, jm: jm, jd: jd };
        }

        function toJalaali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
        function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
        function isLeapJalaaliYear(jy) { return jalCal(jy).leap === 0; }
        function jalaaliMonthLength(jy, jm) {
            if (jm <= 6) return 31;
            if (jm <= 11) return 30;
            return isLeapJalaaliYear(jy) ? 30 : 29;
        }

        const PERSIAN_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
        const PERSIAN_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // Saturday..Friday
        const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        function toPersianDigits(val) { return String(val).replace(/[0-9]/g, d => PERSIAN_DIGITS[d]); }
        function pad2(n) { return String(n).padStart(2, '0'); }

        function createPersianDatePicker(inputEl, iconEl) {
            const popup = document.createElement('div');
            popup.className = 'jdp-popup';
            popup.innerHTML = `
                <div class="jdp-header">
                    <button type="button" class="jdp-next" aria-label="ماه بعد">&#10094;</button>
                    <span class="jdp-title"></span>
                    <button type="button" class="jdp-prev" aria-label="ماه قبل">&#10095;</button>
                </div>
                <div class="jdp-year-select"></div>
                <div class="jdp-weekdays">${PERSIAN_WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>
                <div class="jdp-days"></div>
                <div class="jdp-footer">
                    <button type="button" class="jdp-today-btn">امروز</button>
                    <button type="button" class="jdp-close-btn">بستن</button>
                </div>
            `;
            document.body.appendChild(popup);

            const titleEl = popup.querySelector('.jdp-title');
            const daysEl = popup.querySelector('.jdp-days');
            const yearSelectEl = popup.querySelector('.jdp-year-select');

            const now = new Date();
            const todayJ = toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());

            let view = { jy: todayJ.jy, jm: todayJ.jm };
            let selected = null;

            function render() {
                titleEl.textContent = PERSIAN_MONTHS[view.jm - 1] + ' ' + toPersianDigits(view.jy);
                yearSelectEl.classList.remove('open');

                const g = toGregorian(view.jy, view.jm, 1);
                const jsDay = new Date(g.gy, g.gm - 1, g.gd).getDay(); // 0=Sun..6=Sat
                const startOffset = (jsDay + 1) % 7; // convert to Sat-first index

                const totalDays = jalaaliMonthLength(view.jy, view.jm);
                let html = '';
                for (let i = 0; i < startOffset; i++) html += `<button type="button" disabled></button>`;
                for (let d = 1; d <= totalDays; d++) {
                    const isToday = view.jy === todayJ.jy && view.jm === todayJ.jm && d === todayJ.jd;
                    const isSelected = selected && selected.jy === view.jy && selected.jm === view.jm && selected.jd === d;
                    html += `<button type="button" data-day="${d}" class="${isToday ? 'jdp-today' : ''} ${isSelected ? 'jdp-selected' : ''}">${toPersianDigits(d)}</button>`;
                }
                daysEl.innerHTML = html;
            }

            function positionPopup() {
                const rect = inputEl.getBoundingClientRect();
                popup.style.top = (window.scrollY + rect.bottom + 6) + 'px';
                popup.style.left = (window.scrollX + rect.left) + 'px';
            }

            function open() {
                const val = inputEl.value.trim();
                const m = val.match(/^([۰-۹0-9]{3,4})\/([۰-۹0-9]{1,2})\/([۰-۹0-9]{1,2})$/);
                if (m) {
                    const toEn = s => s.replace(/[۰-۹]/g, d => PERSIAN_DIGITS.indexOf(d));
                    selected = { jy: parseInt(toEn(m[1])), jm: parseInt(toEn(m[2])), jd: parseInt(toEn(m[3])) };
                    view = { jy: selected.jy, jm: selected.jm };
                }
                render();
                positionPopup();
                popup.classList.add('open');
                document.addEventListener('mousedown', onOutsideClick);
            }

            function close() {
                popup.classList.remove('open');
                document.removeEventListener('mousedown', onOutsideClick);
            }

            function onOutsideClick(e) {
                if (!popup.contains(e.target) && e.target !== inputEl && e.target !== iconEl) close();
            }

            function selectDate(jy, jm, jd) {
                selected = { jy, jm, jd };
                const formatted = toPersianDigits(jy) + '/' + toPersianDigits(pad2(jm)) + '/' + toPersianDigits(pad2(jd));
                inputEl.value = formatted;
                inputEl.dispatchEvent(new Event('change'));
            }

            popup.querySelector('.jdp-next').addEventListener('click', () => {
                view.jm -= 1;
                if (view.jm < 1) { view.jm = 12; view.jy -= 1; }
                render();
            });
            popup.querySelector('.jdp-prev').addEventListener('click', () => {
                view.jm += 1;
                if (view.jm > 12) { view.jm = 1; view.jy += 1; }
                render();
            });
            titleEl.addEventListener('click', () => {
                if (yearSelectEl.classList.contains('open')) { yearSelectEl.classList.remove('open'); return; }
                let yHtml = '';
                for (let y = todayJ.jy - 100; y <= todayJ.jy + 10; y++) {
                    yHtml += `<button type="button" data-year="${y}">${toPersianDigits(y)}</button>`;
                }
                yearSelectEl.innerHTML = yHtml;
                yearSelectEl.classList.add('open');
                yearSelectEl.querySelector(`[data-year="${view.jy}"]`)?.scrollIntoView({ block: 'center' });
            });
            yearSelectEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-year]');
                if (!btn) return;
                view.jy = parseInt(btn.dataset.year);
                render();
            });
            daysEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-day]');
                if (!btn) return;
                selectDate(view.jy, view.jm, parseInt(btn.dataset.day));
                render();
                close();
            });
            popup.querySelector('.jdp-today-btn').addEventListener('click', () => {
                view = { jy: todayJ.jy, jm: todayJ.jm };
                selectDate(todayJ.jy, todayJ.jm, todayJ.jd);
                render();
                close();
            });
            popup.querySelector('.jdp-close-btn').addEventListener('click', close);

            inputEl.addEventListener('click', open);
            iconEl.addEventListener('click', (e) => { e.stopPropagation(); open(); });
            window.addEventListener('resize', () => { if (popup.classList.contains('open')) positionPopup(); });
            window.addEventListener('scroll', () => { if (popup.classList.contains('open')) positionPopup(); }, true);

            return { open, close };
        }

        function initDatePicker() {
            try {
                createPersianDatePicker(verifyDateInput, dateIcon);
                verifyDateInput.addEventListener('change', () => { state.verifyDate = verifyDateInput.value; });
                console.log('تقویم شمسی با موفقیت راه‌اندازی شد (بدون وابستگی خارجی).');
            } catch (error) {
                console.warn('خطا در راه‌اندازی تقویم شمسی:', error);
                verifyDateInput.removeAttribute('readonly');
                verifyDateInput.placeholder = 'مثال: ۱۴۰۴/۱۲/۱۵';
                showToast('تقویم شمسی با مشکل مواجه شد. لطفاً تاریخ را دستی وارد کنید.', '#e67e22');
            }
        }

        // ===== INIT =====
        step1.style.display = 'block';
        step2.classList.add('hidden');
        step3.classList.add('hidden');

        initDatePicker();

        console.log('سیستم ثبت مدارک (نسخه اصلاح‌شده) راه‌اندازی شد!');
    })();

