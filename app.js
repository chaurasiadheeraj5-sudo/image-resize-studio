/** SECURITY: filename sanitization **/
    // Strips path separators, control characters and OS-reserved characters from any
    // filename derived from user input (uploaded file names or prompt() text) before
    // it is used as a download filename or a ZIP entry name.
    function sanitizeFilename(name) {
        if (typeof name !== 'string') return 'file';
        let clean = name
            .replace(/[\/\\]/g, '_')          // no path separators (prevents zip-entry path traversal / nested folders)
            .replace(/[\x00-\x1F\x7F]/g, '')  // strip control characters
            .replace(/[<>:"|?*]/g, '_')       // strip characters invalid in Windows/most filesystems
            .replace(/^\.+/, '')              // strip leading dots (hidden files / relative path segments)
            .trim();
        if (!clean) clean = 'file';
        if (clean.length > 150) clean = clean.slice(0, 150);
        return clean;
    }

    /** STATE MANAGEMENT **/
    const app = {
        mode: 'merge', // merge or resize
        resizeFiles: [], mergePics: [], mergeSigs: [], failedItems: [], previewTimeout: null, selectedResizeId: null, previewGen: 0,
        settings: {
            mode: 'merge', showSettings: true,
            rUnit: 'px', rW: '', rH: '', rLock: true, rPreset: 'custom',
            pUnit: 'px', pW: '', pH: '', pLock: true,
            sUnit: 'px', sW: '', sH: '', sLock: true,
            outFmt: 'jpeg', outDPI: 300, outQual: 90, outTarget: ''
        }
    };

    /** TOGGLES & THEME **/
    const sideThemeToggle = document.getElementById('sideThemeToggle');
    const sideSettingsToggle = document.getElementById('sideSettingsToggle');
    const mainWorkspace = document.getElementById('mainWorkspace');

    sideThemeToggle.addEventListener('click', () => {
        const nxt = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', nxt); localStorage.setItem('resizeMergeTheme', nxt);
    });

    sideSettingsToggle.addEventListener('click', () => {
        app.settings.showSettings = !app.settings.showSettings;
        toggleWorkspacePanels();
        saveSettings();
    });

    const savedTheme = localStorage.getItem('resizeMergeTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    /** TOAST NOTIFICATION **/
    let toastTimeout;
    function showToast(msg) {
        const toast = document.getElementById('toast');
        document.getElementById('toastMsg').innerText = msg;
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 4000);
    }

    /** DOM ELEMENTS **/
    const D = {
        modeBtns: document.querySelectorAll('.mode-btn'), upResize: document.getElementById('uploadResize'), upMerge: document.getElementById('uploadMerge'),
        dzResize: document.getElementById('dzResize'), fiResize: document.getElementById('fiResize'), dzPic: document.getElementById('dzPic'), fiPic: document.getElementById('fiPic'), dzSig: document.getElementById('dzSig'), fiSig: document.getElementById('fiSig'),
        listTitle: document.getElementById('listTitle'), listCount: document.getElementById('listCount'), itemList: document.getElementById('itemList'), btnClearAll: document.getElementById('btnClearAll'),
        setResize: document.getElementById('settingsResize'), setMerge: document.getElementById('settingsMerge'), btnProcess: document.getElementById('btnProcess'),
        prevCanvas: document.getElementById('previewCanvas'), prevCtx: document.getElementById('previewCanvas').getContext('2d'), prevPlace: document.getElementById('previewPlaceholder'), prevMeta: document.getElementById('previewMeta'), mDim: document.getElementById('metaDimensions'), mSize: document.getElementById('metaSize'),
        modal: document.getElementById('modal'), mTitle: document.getElementById('mTitle'), mText: document.getElementById('mText'), mProg: document.getElementById('mProg'), mStats: document.getElementById('mStats'), stSuccess: document.getElementById('stSuccess'), stFail: document.getElementById('stFail'), mActions: document.getElementById('mActions'), btnZip: document.getElementById('btnZip'), btnSingle: document.getElementById('btnSingle'), btnClose: document.getElementById('btnClose'), btnRetryFail: document.getElementById('btnRetryFail'),
        inputs: {
            rUnit: document.getElementById('rUnit'), rW: document.getElementById('rW'), rH: document.getElementById('rH'), rPreset: document.getElementById('rPreset'),
            pUnit: document.getElementById('pUnit'), pW: document.getElementById('pW'), pH: document.getElementById('pH'),
            sUnit: document.getElementById('sUnit'), sW: document.getElementById('sW'), sH: document.getElementById('sH'),
            outFmt: document.getElementById('outFmt'), outDPI: document.getElementById('outDPI'), outQual: document.getElementById('outQual'), outTarget: document.getElementById('outTarget')
        },
        locks: { rLock: document.getElementById('rLock'), pLock: document.getElementById('pLock'), sLock: document.getElementById('sLock') }
    };

    /** MODE SWITCHING & LAYOUT HANDLING **/
    function toggleWorkspacePanels() {
        mainWorkspace.classList.toggle('show-settings', app.settings.showSettings);
        sideSettingsToggle.classList.toggle('active-state', app.settings.showSettings);
        
        if (app.mode === 'resize') {
            D.listTitle.innerText = "Uploaded Images";
            D.btnProcess.innerText = "BULK RESIZE & DOWNLOAD";
        } else {
            D.listTitle.innerText = "Picture + Signature Pairs";
            D.btnProcess.innerText = "PROCESS & DOWNLOAD MERGED";
        }
    }

    D.modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            D.modeBtns.forEach(b => b.classList.remove('active')); e.target.classList.add('active');
            app.mode = app.settings.mode = e.target.dataset.mode;
            
            if (app.mode === 'resize') {
                D.upMerge.classList.remove('active'); setTimeout(() => { D.upMerge.style.display = 'none'; D.upResize.style.display = 'block'; setTimeout(() => D.upResize.classList.add('active'), 10); }, 300);
                D.setMerge.classList.remove('active'); setTimeout(() => { D.setMerge.style.display = 'none'; D.setResize.style.display = 'block'; setTimeout(() => D.setResize.classList.add('active'), 10); }, 300);
            } else {
                D.upResize.classList.remove('active'); setTimeout(() => { D.upResize.style.display = 'none'; D.upMerge.style.display = 'grid'; setTimeout(() => D.upMerge.classList.add('active'), 10); }, 300);
                D.setResize.classList.remove('active'); setTimeout(() => { D.setResize.style.display = 'none'; D.setMerge.style.display = 'block'; setTimeout(() => D.setMerge.classList.add('active'), 10); }, 300);
            }

            toggleWorkspacePanels();
            updateListUI(); queuePreview(); saveSettings();
        });
    });

    /** DIMENSION LINKING & SYNC **/
    Object.keys(D.inputs).forEach(k => { if(D.inputs[k]) { D.inputs[k].addEventListener('input', e => { app.settings[k] = e.target.value; saveSettings(); queuePreview(); }); } });

    const handleLock = (type) => {
        let lockKey = type+'Lock'; app.settings[lockKey] = !app.settings[lockKey];
        D.locks[lockKey].classList.toggle('locked', app.settings[lockKey]); saveSettings();
        syncDim(type, true);
    };
    D.locks.rLock.addEventListener('click', () => handleLock('r')); D.locks.pLock.addEventListener('click', () => handleLock('p')); D.locks.sLock.addEventListener('click', () => handleLock('s'));

    const syncDim = (type, isW) => {
        const s = app.settings; let lck, inW, inH, file;
        if(type==='r'){ lck=s.rLock; inW=D.inputs.rW; inH=D.inputs.rH; file=app.resizeFiles[0]; }
        if(type==='p'){ lck=s.pLock; inW=D.inputs.pW; inH=D.inputs.pH; file=app.mergePics[0]; }
        if(type==='s'){ lck=s.sLock; inW=D.inputs.sW; inH=D.inputs.sH; file=app.mergeSigs[0]; }
        
        const srcVal = isW ? inW.value : inH.value;
        if(!lck || srcVal === "" || !file) return;
        
        const ratio = file.w / file.h;
        if(isW) inH.value = (parseFloat(inW.value) / ratio).toFixed(2).replace(/\.00$/, '');
        else inW.value = (parseFloat(inH.value) * ratio).toFixed(2).replace(/\.00$/, '');
        
        if(type==='r'){ s.rW=inW.value; s.rH=inH.value; } if(type==='p'){ s.pW=inW.value; s.pH=inH.value; } if(type==='s'){ s.sW=inW.value; s.sH=inH.value; }
    };
    D.inputs.rW.addEventListener('input', () => syncDim('r', true)); D.inputs.rH.addEventListener('input', () => syncDim('r', false));
    D.inputs.pW.addEventListener('input', () => syncDim('p', true)); D.inputs.pH.addEventListener('input', () => syncDim('p', false));
    D.inputs.sW.addEventListener('input', () => syncDim('s', true)); D.inputs.sH.addEventListener('input', () => syncDim('s', false));

    // Batch Resize Presets
    D.inputs.rPreset.addEventListener('change', (e) => {
        if(e.target.value === 'custom') return;
        let w='', h='';
        if(e.target.value === 'original' && app.resizeFiles.length>0) { w = app.resizeFiles[0].w; h = app.resizeFiles[0].h; D.inputs.rUnit.value = 'px'; }
        else if(e.target.value === 'hd') { w = 1920; h = 1080; D.inputs.rUnit.value = 'px'; }
        else if(e.target.value === 'social') { w = 1080; h = 1080; D.inputs.rUnit.value = 'px'; }
        else if(e.target.value === '50p') { w = 50; h = 50; D.inputs.rUnit.value = '%'; }
        D.inputs.rW.value = w; D.inputs.rH.value = h; app.settings.rW = w; app.settings.rH = h; app.settings.rUnit = D.inputs.rUnit.value;
        queuePreview();
    });

    /** UPLOAD HANDLING & FILE PROCESSING **/
    const bindDrop = (dz, fi, targetArr) => {
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); const files = Array.from(e.dataTransfer.files); if(files.length) processFiles(files, targetArr); });
        fi.addEventListener('change', e => { const files = Array.from(e.target.files); fi.value = ''; if(files.length) processFiles(files, targetArr); });
    };
    bindDrop(D.dzResize, D.fiResize, 'resizeFiles'); bindDrop(D.dzPic, D.fiPic, 'mergePics'); bindDrop(D.dzSig, D.fiSig, 'mergeSigs');

    const loadImage = src => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
    async function processFiles(files, targetKey) {
        const valid = ['image/jpeg', 'image/png', 'image/webp'];
        
        if (app.mode === 'merge') {
            let fileToProcess = null;
            for(let file of files) {
                if(valid.includes(file.type)) { fileToProcess = file; break; }
            }
            if (!fileToProcess) return;

            app[targetKey].forEach(f => URL.revokeObjectURL(f.url));
            app[targetKey] = [];

            const url = URL.createObjectURL(fileToProcess);
            try { 
                const img = await loadImage(url); 
                app[targetKey].push({ id: 'f_'+Math.random().toString(36).substr(2,9), name: fileToProcess.name, url: url, img: img, w: img.width, h: img.height, size: fileToProcess.size, raw: fileToProcess }); 
            } catch(e) { URL.revokeObjectURL(url); }
        } else {
            // Bulk Resize allows multiple files
            for(let file of files) {
                if(!valid.includes(file.type)) continue; 
                const url = URL.createObjectURL(file);
                try { 
                    const img = await loadImage(url); 
                    app[targetKey].push({ id: 'f_'+Math.random().toString(36).substr(2,9), name: file.name, url: url, img: img, w: img.width, h: img.height, size: file.size, raw: file }); 
                } catch(e) { URL.revokeObjectURL(url); }
            }
        }
        updateListUI(); queuePreview();
    }

    D.btnClearAll.addEventListener('click', () => {
        if(app.mode === 'resize') { app.resizeFiles.forEach(f => URL.revokeObjectURL(f.url)); app.resizeFiles = []; }
        else { app.mergePics.forEach(f => URL.revokeObjectURL(f.url)); app.mergePics = []; app.mergeSigs.forEach(f => URL.revokeObjectURL(f.url)); app.mergeSigs = []; }
        updateListUI(); queuePreview();
    });

    function removeItem(modeKey, id) {
        const arr = app[modeKey]; const idx = arr.findIndex(f => f.id === id);
        if(idx > -1) { URL.revokeObjectURL(arr[idx].url); arr.splice(idx, 1); updateListUI(); queuePreview(); }
    }

    function selectResizeItem(id, evt) {
        if(evt) evt.stopPropagation();
        app.selectedResizeId = id; updateListUI(); queuePreview();
    }

    function updateDropzoneState(dz, count, defaultText) {
        const svg = dz.querySelector('.dz-icon'); const txt = dz.querySelector('.upload-text');
        if (count > 0) {
            dz.classList.add('uploaded');
            svg.innerHTML = `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>`; 
            svg.style.fill = "var(--success)"; 
            txt.innerText = app.mode === 'resize' ? `${count} Images Selected` : `Image Added`;
        } else {
            dz.classList.remove('uploaded'); svg.style.fill = "var(--text-muted)"; txt.innerText = defaultText;
            if(dz === D.dzPic || dz === D.dzResize) svg.innerHTML = `<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>`;
            else if(dz === D.dzSig) svg.innerHTML = `<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>`;
        }
    }

    function makeThumbRow(item, labelText, labelColor, modeKey) {
        const row = document.createElement('div');
        row.className = 'pair-row';
        const label = document.createElement('div');
        label.className = 'pair-label';
        if(labelColor) label.style.color = labelColor;
        label.textContent = labelText;
        row.appendChild(label);
        const img = document.createElement('img');
        img.src = item.url; img.className = 'item-thumb'; img.alt = '';
        row.appendChild(img);
        const info = document.createElement('div');
        info.className = 'item-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'item-name'; nameEl.textContent = item.name;
        info.appendChild(nameEl);
        row.appendChild(info);
        const btn = document.createElement('button');
        btn.className = 'btn-icon-small'; btn.type = 'button'; btn.textContent = '✖';
        btn.addEventListener('click', (e) => { e.stopPropagation(); removeItem(modeKey, item.id); });
        row.appendChild(btn);
        return row;
    }

    function makeMissingRow(labelText, labelColor, missingText) {
        const row = document.createElement('div');
        row.className = 'pair-row';
        const label = document.createElement('div');
        label.className = 'pair-label';
        if(labelColor) label.style.color = labelColor;
        label.textContent = labelText;
        row.appendChild(label);
        const missing = document.createElement('div');
        missing.className = 'pair-missing';
        missing.style.borderColor = 'var(--glass-border)'; missing.style.color = 'var(--text-muted)';
        missing.textContent = missingText;
        row.appendChild(missing);
        return row;
    }

    function updateListUI() {
        D.itemList.innerHTML = '';
        if(app.mode === 'resize') {
            D.listCount.innerText = `${app.resizeFiles.length} Images`; D.btnProcess.disabled = app.resizeFiles.length === 0;
            updateDropzoneState(D.dzResize, app.resizeFiles.length, "+ Add Multiple Images");

            if(app.resizeFiles.length === 0) { app.selectedResizeId = null; }
            else if(!app.resizeFiles.some(f => f.id === app.selectedResizeId)) { app.selectedResizeId = app.resizeFiles[0].id; }

            app.resizeFiles.forEach((item) => {
                const isSel = item.id === app.selectedResizeId;
                const div = document.createElement('div');
                div.className = 'list-item' + (isSel ? ' selected' : '');
                div.addEventListener('click', (e) => selectResizeItem(item.id, e));

                const img = document.createElement('img');
                img.src = item.url; img.className = 'item-thumb'; img.alt = '';
                div.appendChild(img);

                const info = document.createElement('div');
                info.className = 'item-info';
                const nameEl = document.createElement('div');
                nameEl.className = 'item-name'; nameEl.textContent = item.name;
                const metaEl = document.createElement('div');
                metaEl.className = 'item-meta'; metaEl.textContent = `${item.w} × ${item.h}`;
                info.appendChild(nameEl); info.appendChild(metaEl);
                div.appendChild(info);

                const btn = document.createElement('button');
                btn.className = 'btn-icon-small'; btn.type = 'button'; btn.textContent = '✖';
                btn.addEventListener('click', (e) => { e.stopPropagation(); removeItem('resizeFiles', item.id); });
                div.appendChild(btn);

                D.itemList.appendChild(div);
            });
        } else {
            const count = Math.max(app.mergePics.length, app.mergeSigs.length);
            D.listCount.innerText = `${count} Pair${count!==1?'s':''}`; D.btnProcess.disabled = count === 0;
            updateDropzoneState(D.dzPic, app.mergePics.length, "+ Add Picture"); updateDropzoneState(D.dzSig, app.mergeSigs.length, "+ Add Signature");

            for(let i=0; i<count; i++) {
                const pic = app.mergePics[i]; const sig = app.mergeSigs[i];
                const pair = document.createElement('div');
                pair.className = 'merge-pair';
                pair.appendChild(pic ? makeThumbRow(pic, 'PIC', null, 'mergePics') : makeMissingRow('PIC', null, 'Standalone Signature Setup'));
                pair.appendChild(sig ? makeThumbRow(sig, 'SIG', 'var(--secondary)', 'mergeSigs') : makeMissingRow('SIG', 'var(--secondary)', 'Standalone Picture Setup'));
                D.itemList.appendChild(pair);
            }
        }
    }

    /** MATH & RENDERING **/
    function cvtPx(val, unit, orig, dpi) {
        if(!val) return null; const n = parseFloat(val); if(isNaN(n)||n<=0) return null;
        let d = parseFloat(dpi)||300; switch(unit) { case 'px': return n; case '%': return orig*(n/100); case 'cm': return (n/2.54)*d; case 'mm': return (n/25.4)*d; default: return orig; }
    }
    
    function getMergeDim(s, picImg, sigImg) {
        let baseW = picImg ? picImg.w : (sigImg ? sigImg.w : 1000);
        let baseH = picImg ? picImg.h : (sigImg ? sigImg.h : 1200);

        let pw = cvtPx(s.pW, s.pUnit, baseW, s.outDPI) || baseW;
        let ph = cvtPx(s.pH, s.pUnit, baseH, s.outDPI) || baseH;
        let sw = cvtPx(s.sW, s.sUnit, baseW, s.outDPI) || baseW;
        let sh = cvtPx(s.sH, s.sUnit, baseH, s.outDPI) || 300;

        let standalonePicW = Math.round(pw); let standalonePicH = Math.round(ph);
        let standaloneSigW = Math.round(sw); let standaloneSigH = Math.round(sh);

        let fw = Math.max(standalonePicW, standaloneSigW);
        let fh = standalonePicH + standaloneSigH;

        return { fw, fh, pw, ph, sw, sh, standalonePicW, standalonePicH, standaloneSigW, standaloneSigH, finalPh: standalonePicH, finalSh: standaloneSigH };
    }

    function getResizeDim(img, s) {
        let w = cvtPx(s.rW, s.rUnit, img.w, s.outDPI), h = cvtPx(s.rH, s.rUnit, img.h, s.outDPI);
        if(s.rLock) { if(w&&!h) h=img.h*(w/img.w); else if(!w&&h) w=img.w*(h/img.h); }
        if(!w) w=img.w; if(!h) h=img.h; return { w: Math.round(w), h: Math.round(h) };
    }

    function drawHQ(ctx, img, dx, dy, dw, dh) {
        if (!img || dw<=0 || dh<=0) return; let sx=0, sy=0, sw=img.width, sh=img.height;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    /** LIVE PREVIEW **/
    function queuePreview() { clearTimeout(app.previewTimeout); app.previewTimeout = setTimeout(() => requestAnimationFrame(renderPreview), 50); }

    // Mirrors expBlob()'s quality/downscale search used at export time, but also
    // reports the resulting width/height so the live preview can show an accurate
    // estimate when a Target Size (KB) is set.
    async function estimateTargetFit(canvas, type, s) {
        const tkb = parseFloat(s.outTarget);
        if (!((type === 'image/jpeg' || type === 'image/webp') && !isNaN(tkb) && tkb > 0)) return null;
        const tb = tkb * 1024;
        const chk = (c, q) => new Promise(r => c.toBlob(r, type, q));
        let mn = 0.0, mx = 1.0, bst = null;
        let f = await chk(canvas, 1.0);
        if (f.size <= tb) return { w: canvas.width, h: canvas.height, size: f.size };
        for (let i = 0; i < 7; i++) {
            let m = (mn + mx) / 2; let t = await chk(canvas, m);
            if (t.size > tb) mx = m; else { mn = m; bst = t; }
        }
        let best = bst || await chk(canvas, mn);
        if (best.size > tb) {
            let scale = 0.85; const tmpC = document.createElement('canvas'); const tmpCtx = tmpC.getContext('2d');
            let lastFit = best; let lastW = canvas.width, lastH = canvas.height;
            while (lastFit.size > tb && scale > 0.1) {
                tmpC.width = Math.max(1, Math.round(canvas.width * scale)); tmpC.height = Math.max(1, Math.round(canvas.height * scale));
                tmpCtx.drawImage(canvas, 0, 0, tmpC.width, tmpC.height);
                lastFit = await chk(tmpC, 0.4); lastW = tmpC.width; lastH = tmpC.height;
                scale -= 0.15;
            }
            tmpC.width = 0; tmpC.height = 0;
            return { w: lastW, h: lastH, size: lastFit.size };
        }
        return { w: canvas.width, h: canvas.height, size: best.size };
    }

    function renderPreview() {
        const s = app.settings; let w=0, h=0;
        if (app.mode === 'resize') {
            if (app.resizeFiles.length===0) { resetPreview(); return; }
            const selImg = app.resizeFiles.find(f => f.id === app.selectedResizeId) || app.resizeFiles[0];
            let d = getResizeDim(selImg, s); w = d.w; h = d.h;
        } else {
            if (app.mergePics.length===0 && app.mergeSigs.length===0) { resetPreview(); return; }
            let d = getMergeDim(s, app.mergePics[0], app.mergeSigs[0]); 
            let hasPic = !!app.mergePics[0]; let hasSig = !!app.mergeSigs[0];
            if(hasPic && hasSig) { w = d.fw; h = d.fh; }
            else if (hasPic) { w = d.standalonePicW; h = d.standalonePicH; }
            else { w = d.standaloneSigW; h = d.standaloneSigH; }
        }

        D.prevPlace.style.display = 'none'; D.prevCanvas.style.opacity = '1'; D.prevMeta.style.display = 'flex';
        const scale = Math.min(1, 800 / Math.max(w, h)); D.prevCanvas.width = w * scale; D.prevCanvas.height = h * scale;
        D.prevCtx.fillStyle = '#FFFFFF'; D.prevCtx.fillRect(0,0,D.prevCanvas.width, D.prevCanvas.height);

        if (app.mode === 'resize') {
            const selImg = app.resizeFiles.find(f => f.id === app.selectedResizeId) || app.resizeFiles[0];
            drawHQ(D.prevCtx, selImg.img, 0, 0, w*scale, h*scale);
        } else {
            let d = getMergeDim(s, app.mergePics[0], app.mergeSigs[0]);
            let hasPic = !!app.mergePics[0]; let hasSig = !!app.mergeSigs[0];
            
            if (hasPic && hasSig) {
                let picDx = (d.fw - d.standalonePicW) / 2; let sigDx = (d.fw - d.standaloneSigW) / 2;
                drawHQ(D.prevCtx, app.mergePics[0].img, picDx*scale, 0, d.standalonePicW*scale, d.standalonePicH*scale);
                drawHQ(D.prevCtx, app.mergeSigs[0].img, sigDx*scale, d.standalonePicH*scale, d.standaloneSigW*scale, d.standaloneSigH*scale);
                D.prevCtx.strokeStyle = 'rgba(0,0,0,0.1)'; D.prevCtx.lineWidth = 1; D.prevCtx.beginPath(); D.prevCtx.moveTo(0, d.standalonePicH*scale); D.prevCtx.lineTo(d.fw*scale, d.standalonePicH*scale); D.prevCtx.stroke();
            } else if (hasPic) {
                drawHQ(D.prevCtx, app.mergePics[0].img, 0, 0, w*scale, h*scale);
            } else {
                drawHQ(D.prevCtx, app.mergeSigs[0].img, 0, 0, w*scale, h*scale);
            }
        }

        D.mDim.innerText = `${w} × ${h} px`;

        const type = s.outFmt==='png'?'image/png':(s.outFmt==='jpg'?'image/jpeg':(s.outFmt==='webp'?'image/webp':'image/jpeg'));
        const tkb = parseFloat(s.outTarget);
        const gen = ++app.previewGen;

        if ((type==='image/jpeg'||type==='image/webp') && !isNaN(tkb) && tkb>0) {
            // Build a full-resolution offscreen render (matching real export size) so the
            // target-size search below produces an accurate size/dimension estimate.
            const fullCanvas = document.createElement('canvas'); fullCanvas.width = w; fullCanvas.height = h;
            const fctx = fullCanvas.getContext('2d');
            fctx.fillStyle = '#FFFFFF'; fctx.fillRect(0,0,w,h);
            if (app.mode === 'resize') {
                const selImg = app.resizeFiles.find(f => f.id === app.selectedResizeId) || app.resizeFiles[0];
                drawHQ(fctx, selImg.img, 0, 0, w, h);
            } else {
                let d = getMergeDim(s, app.mergePics[0], app.mergeSigs[0]);
                let hasPic = !!app.mergePics[0]; let hasSig = !!app.mergeSigs[0];
                if (hasPic && hasSig) {
                    let picDx = (d.fw - d.standalonePicW) / 2; let sigDx = (d.fw - d.standaloneSigW) / 2;
                    drawHQ(fctx, app.mergePics[0].img, picDx, 0, d.standalonePicW, d.standalonePicH);
                    drawHQ(fctx, app.mergeSigs[0].img, sigDx, d.standalonePicH, d.standaloneSigW, d.standaloneSigH);
                } else if (hasPic) {
                    drawHQ(fctx, app.mergePics[0].img, 0, 0, w, h);
                } else {
                    drawHQ(fctx, app.mergeSigs[0].img, 0, 0, w, h);
                }
            }
            D.mSize.innerText = `Estimating...`;
            estimateTargetFit(fullCanvas, type, s).then(est => {
                fullCanvas.width = 0; fullCanvas.height = 0;
                if (gen !== app.previewGen) return; // a newer preview superseded this one
                if (est) {
                    D.mDim.innerText = `Est: ${est.w} × ${est.h} px`;
                    D.mSize.innerText = `Est Size: ~${Math.round(est.size/1024)} KB (target ${Math.round(tkb)} KB)`;
                }
            });
        } else {
            setTimeout(() => {
                if (gen !== app.previewGen) return;
                let q = (parseFloat(s.outQual)||90)/100;
                D.mSize.innerText = `Est Size: ~${Math.round((D.prevCanvas.toDataURL(type,q).length*3/4)/1024)} KB`;
            }, 10);
        }
    }
    function resetPreview() { D.prevCtx.clearRect(0,0,D.prevCanvas.width,D.prevCanvas.height); D.prevPlace.style.display='flex'; D.prevCanvas.style.opacity='0'; D.prevMeta.style.display='none'; }


    /** PROCESSING & EXPORT (WITH CUSTOM PROMPTS) **/
    let outBlobs = [];
    
    D.btnProcess.addEventListener('click', async () => {
        const count = app.mode === 'resize' ? app.resizeFiles.length : Math.max(app.mergePics.length, app.mergeSigs.length);
        if(count === 0) return;

        D.modal.classList.add('active'); D.mActions.style.display='none'; 
        D.mStats.style.display = count > 1 ? 'flex' : 'none'; 
        D.mProg.style.width='0%'; outBlobs=[]; app.failedItems=[]; let ok=0, fail=0; 
        D.stSuccess.innerText='0 Done'; D.stFail.innerText='0 Failed';
        D.btnRetryFail.style.display = 'none';
        
        const s = app.settings; let type = s.outFmt==='png'?'image/png':(s.outFmt==='jpg'?'image/jpeg':(s.outFmt==='webp'?'image/webp':'image/jpeg')); let ext = s.outFmt==='jpeg'?'jpg':s.outFmt;
        const oc = document.createElement('canvas'); const octx = oc.getContext('2d');
        let autoResized = false; 

        try {
            if (app.mode === 'resize') {
                D.mTitle.innerText = "Resizing Batch...";
                for(let i=0; i<app.resizeFiles.length; i++) {
                    const f = app.resizeFiles[i]; D.mText.innerText = `Processing: ${f.name}`; D.mProg.style.width = `${((i)/count)*100}%`;
                    try {
                        let d = getResizeDim(f, s); oc.width=d.w; oc.height=d.h;
                        if(type==='image/jpeg'){ octx.fillStyle='#FFFFFF'; octx.fillRect(0,0,d.w,d.h); } else { octx.clearRect(0,0,d.w,d.h); }
                        drawHQ(octx, f.img, 0,0,d.w,d.h);
                        const blob = await expBlob(oc, type, s, () => autoResized = true);
                        outBlobs.push({ name: `${sanitizeFilename(f.name.replace(/\.[^/.]+$/, ""))}_resized.${ext}`, blob: blob });
                        ok++; D.stSuccess.innerText=`${ok} Done`;
                    } catch(e) { fail++; D.stFail.innerText=`${fail} Failed`; app.failedItems.push(f); }
                    await new Promise(r=>setTimeout(r,5));
                }
            } else {
                D.mTitle.innerText = "Processing Pairs...";
                for(let i=0; i<count; i++) {
                    const p = app.mergePics[i]; const sg = app.mergeSigs[i];
                    D.mText.innerText = `Processing Step ${i+1} of ${count}`; D.mProg.style.width = `${((i)/count)*100}%`;
                    try {
                        let d = getMergeDim(s, p, sg); 
                        
                        if (p && sg) {
                            oc.width=d.fw; oc.height=d.fh;
                            if(type==='image/jpeg'){ octx.fillStyle='#FFFFFF'; octx.fillRect(0,0,d.fw,d.fh); } else { octx.clearRect(0,0,d.fw,d.fh); }
                            let picDx = (d.fw - d.standalonePicW) / 2; let sigDx = (d.fw - d.standaloneSigW) / 2;
                            drawHQ(octx, p.img, picDx,0,d.standalonePicW,d.standalonePicH);
                            drawHQ(octx, sg.img, sigDx,d.standalonePicH,d.standaloneSigW,d.standaloneSigH);
                            const blob = await expBlob(oc, type, s, () => autoResized = true);
                            let bname = sanitizeFilename(p.name.replace(/\.[^/.]+$/, ""));
                            outBlobs.push({ name: `${bname}_merged.${ext}`, blob: blob });
                        } else if (p) {
                            oc.width=d.standalonePicW; oc.height=d.standalonePicH;
                            if(type==='image/jpeg'){ octx.fillStyle='#FFFFFF'; octx.fillRect(0,0,d.standalonePicW,d.standalonePicH); } else { octx.clearRect(0,0,d.standalonePicW,d.standalonePicH); }
                            drawHQ(octx, p.img, 0,0,d.standalonePicW,d.standalonePicH);
                            const blob = await expBlob(oc, type, s, () => autoResized = true);
                            let bname = sanitizeFilename(p.name.replace(/\.[^/.]+$/, ""));
                            outBlobs.push({ name: `${bname}_resized.${ext}`, blob: blob });
                        } else if (sg) {
                            oc.width=d.standaloneSigW; oc.height=d.standaloneSigH;
                            if(type==='image/jpeg'){ octx.fillStyle='#FFFFFF'; octx.fillRect(0,0,d.standaloneSigW,d.standaloneSigH); } else { octx.clearRect(0,0,d.standaloneSigW,d.standaloneSigH); }
                            drawHQ(octx, sg.img, 0,0,d.standaloneSigW,d.standaloneSigH);
                            const blob = await expBlob(oc, type, s, () => autoResized = true);
                            let bname = sanitizeFilename(sg.name.replace(/\.[^/.]+$/, ""));
                            outBlobs.push({ name: `${bname}_resized.${ext}`, blob: blob });
                        }
                        ok++; D.stSuccess.innerText=`${ok} Done`;
                    } catch(e) { fail++; D.stFail.innerText=`${fail} Failed`; app.failedItems.push({p, sg}); }
                    await new Promise(r=>setTimeout(r,5));
                }
            }
            
            oc.width=0; oc.height=0; D.mProg.style.width="100%";
            if(autoResized) showToast(`Output auto-scaled to meet ${s.outTarget} KB limit.`);

            if(fail === 0) {
                D.mTitle.innerText = "Complete!";
                D.mText.innerText = "Please provide a file name...";
                
                setTimeout(() => {
                    if(outBlobs.length > 1) { D.btnZip.click(); } else if(outBlobs.length===1) { D.btnSingle.click(); }
                    D.modal.classList.remove('active'); 
                    outBlobs=[];
                }, 100);

            } else {
                D.mTitle.innerText = "Completed with Errors";
                D.mText.innerText = "Some images failed processing.";
                D.mActions.style.display='flex';
                D.btnRetryFail.style.display = 'inline-flex';
                if(outBlobs.length > 1) { D.btnZip.style.display='inline-flex'; D.btnSingle.style.display='none'; }
                else if(outBlobs.length===1) { D.btnZip.style.display='none'; D.btnSingle.style.display='inline-flex'; }
            }

        } catch(e) { D.mTitle.innerText="Error"; D.mText.innerText="Critical processing failure."; D.mActions.style.display='flex'; }
    });

    D.btnRetryFail.addEventListener('click', () => {
        if(app.mode === 'resize') { app.resizeFiles = [...app.failedItems]; }
        else {
            app.mergePics = app.failedItems.map(i => i.p).filter(Boolean);
            app.mergeSigs = app.failedItems.map(i => i.sg).filter(Boolean);
        }
        updateListUI(); queuePreview(); D.modal.classList.remove('active');
    });

    async function expBlob(canvas, type, s, onAutoResize) {
        return new Promise(res => {
            const tkb = parseFloat(s.outTarget);
            if ((type==='image/jpeg'||type==='image/webp') && !isNaN(tkb) && tkb>0) {
                const tb = tkb*1024; let mn=0.0, mx=1.0, bst=null; const chk = (c, q) => new Promise(r => c.toBlob(r, type, q));
                const srch = async (cvs) => { 
                    let f = await chk(cvs, 1.0); if(f.size <= tb) return res(f); 
                    for(let i=0; i<7; i++) { let m=(mn+mx)/2; let t=await chk(cvs, m); if(t.size>tb) mx=m; else { mn=m; bst=t; } } 
                    let best = bst || await chk(cvs, mn);
                    
                    if(best.size > tb) {
                        if(onAutoResize) onAutoResize();
                        let scale = 0.85; let tmpC = document.createElement('canvas'); let tmpCtx = tmpC.getContext('2d');
                        let lastFit = best;
                        while(lastFit.size > tb && scale > 0.1) {
                            tmpC.width = Math.max(1, cvs.width * scale); tmpC.height = Math.max(1, cvs.height * scale);
                            tmpCtx.drawImage(cvs, 0, 0, tmpC.width, tmpC.height);
                            lastFit = await chk(tmpC, 0.4); scale -= 0.15;
                        }
                        return res(lastFit);
                    }
                    res(best); 
                }; srch(canvas);
            } else { canvas.toBlob(res, type, (parseFloat(s.outQual)||90)/100); }
        });
    }

    D.btnSingle.addEventListener('click', () => { 
        if(!outBlobs.length) return; 
        
        let ext = outBlobs[0].name.split('.').pop();
        let defaultName = "processed image." + ext;
        let fileName = prompt("Enter file name to save:", defaultName);
        if(!fileName) return; 
        fileName = sanitizeFilename(fileName);

        if(!fileName.toLowerCase().endsWith(`.${ext}`)) fileName += `.${ext}`;

        const u = URL.createObjectURL(outBlobs[0].blob); 
        const a = document.createElement('a'); 
        a.href=u; a.download=fileName; 
        document.body.appendChild(a); a.click(); document.body.removeChild(a); 
        setTimeout(()=>URL.revokeObjectURL(u),1000); 
    });

    D.btnZip.addEventListener('click', async () => {
        if(!outBlobs.length || !window.JSZip) return; 
        
        let fileName = prompt("Enter ZIP file name to save:", "Batch_Output.zip");
        if(!fileName) return; 
        fileName = sanitizeFilename(fileName);
        if(!fileName.toLowerCase().endsWith('.zip')) fileName += '.zip';

        D.mText.innerText = "Creating ZIP..."; D.btnZip.disabled=true;
        try { 
            const zip = new JSZip(); 
            outBlobs.forEach(i => zip.file(i.name, i.blob)); 
            const zb = await zip.generateAsync({type:"blob"}); 
            const u = URL.createObjectURL(zb); 
            const a = document.createElement('a'); 
            a.href=u; a.download=fileName; 
            document.body.appendChild(a); a.click(); document.body.removeChild(a); 
            setTimeout(()=>URL.revokeObjectURL(u),1000); 
            D.mText.innerText = "ZIP Downloaded."; 
        } catch(e) { 
            D.mText.innerText = "ZIP generation failed."; 
        } 
        D.btnZip.disabled=false;
    });

    D.btnClose.addEventListener('click', () => { D.modal.classList.remove('active'); outBlobs=[]; });

    /** PERSISTENCE **/
    function saveSettings() { localStorage.setItem('resMergeStudioPref', JSON.stringify(app.settings)); }
    function loadSettings() {
        try {
            const sv = localStorage.getItem('resMergeStudioPref');
            if(sv) {
                app.settings = {...app.settings, ...JSON.parse(sv)};
                Object.keys(D.inputs).forEach(k => { if(D.inputs[k]) D.inputs[k].value = app.settings[k]||''; });
                
                if (typeof app.settings.showSettings === 'undefined') app.settings.showSettings = true;
                
                D.locks.rLock.classList.toggle('locked', app.settings.rLock); D.locks.pLock.classList.toggle('locked', app.settings.pLock); D.locks.sLock.classList.toggle('locked', app.settings.sLock);
            }
        } catch(e){}
        
        app.mode = app.settings.mode = 'merge'; 
        D.modeBtns.forEach(b => b.classList.remove('active')); 
        document.querySelector('.mode-btn[data-mode="merge"]').classList.add('active');
        
        D.upResize.style.display = 'none'; D.upResize.classList.remove('active'); 
        D.upMerge.style.display = 'grid'; D.upMerge.classList.add('active'); 
        D.setResize.style.display = 'none'; D.setResize.classList.remove('active'); 
        D.setMerge.style.display = 'block'; D.setMerge.classList.add('active'); 
        
        toggleWorkspacePanels();
    }
    
    document.addEventListener('DOMContentLoaded', loadSettings);
