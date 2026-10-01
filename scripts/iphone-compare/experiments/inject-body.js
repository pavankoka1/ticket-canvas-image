    const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const font = b64(await (await fetch('/fonts/onest-700.woff2')).arrayBuffer());
    const imgs = {};
    for (const u of ['/dab-full.png', '/badge-circle.png', '/dab-disabled.png', '/badge-circle-disabled.png']) imgs[u] = 'data:image/png;base64,' + b64(await (await fetch(u)).arrayBuffer());
    window.__fo = { font, imgs };
    window.__baseDelta = (el, html, card) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const cr = card.getBoundingClientRect();
      const topCss = r.top - cr.top; // exact LayoutUnit offset inside the card
      const mk = (zoom) => { const host = document.createElement('div'); host.style.cssText = `position:absolute;left:0;top:0;width:${cr.width}px;height:${cr.height}px;zoom:${zoom}`;
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:0;top:${topCss}px;box-sizing:border-box;width:${r.width}px;height:${r.height}px;display:${cs.display};flex-direction:${cs.flexDirection};align-items:${cs.alignItems};justify-content:${cs.justifyContent};padding:${cs.padding};white-space:nowrap;font-family:${cs.fontFamily};font-weight:${cs.fontWeight};font-size:${cs.fontSize};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing}`;
        d.innerHTML = '<span>' + html + '<span style="display:inline-block;width:0;height:0"></span></span>'; host.append(d); document.body.append(host);
        const v = (d.querySelector('span > span').getBoundingClientRect().top - host.getBoundingClientRect().top) * devicePixelRatio; host.remove(); return v; };
      return mk(1) - mk(devicePixelRatio) / devicePixelRatio;
    };
    window.__raster = async (card, canvas, mode) => {
      const d = devicePixelRatio;
      let css = '';
      for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) css += r.cssText + '\n'; } catch {} }
      css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (f, q, u) => { const k = Object.keys(window.__fo.imgs).find(x => u.endsWith(x)); return k ? `url("${window.__fo.imgs[k]}")` : f; });
      const src = `url(data:font/woff2;base64,${window.__fo.font}) format('woff2')`;
      css += `@font-face{font-family:'MB-Onest';font-weight:700;src:${src}}@font-face{font-family:Onest;font-weight:700;src:${src}}`;
      const rect = card.getBoundingClientRect(); const W = rect.width, H = rect.height;
      const clone = card.cloneNode(true);
      const cs = getComputedStyle(card); for (let i = 0; i < cs.length; i++) { const pr = cs.item(i); if (pr.startsWith('--')) clone.style.setProperty(pr, cs.getPropertyValue(pr)); }
      Object.assign(clone.style, { position: 'absolute', left: '0px', top: '0px', transform: 'none', visibility: 'visible', margin: '0' });
      if (mode === 'zoom+base') {
        const d0 = devicePixelRatio;
        const liveTexts = (root) => [...root.querySelectorAll('.ticketCard__id, .ticketCard__win')];
        const L = liveTexts(card), C = liveTexts(clone);
        L.forEach((el, i) => { const t = [...el.childNodes].find(n => n.nodeType === 3 && n.data.trim()); if (!t) return;
          const delta = window.__baseDelta(el, t.data.replace(/&/g, '&amp;').replace(/</g, '&lt;'), card);
          const ct = [...C[i].childNodes].find(n => n.nodeType === 3 && n.data.trim()); const sp = document.createElement('span'); sp.textContent = ct.data; ct.replaceWith(sp);
          (window.__deltas ||= []).push({[el.className]:+delta.toFixed(4)}); if (delta) sp.style.transform = `translateY(${delta / d0}px)`; });
        // badge hosts: copy the DOM's resolved (already 1/64-truncated) box into the clone
        const LH = [...card.querySelectorAll('.ticketCard__badgeHost')], CH = [...clone.querySelectorAll('.ticketCard__badgeHost')];
        LH.forEach((h, i) => { const hr = h.getBoundingClientRect(), pr = h.parentElement.getBoundingClientRect();
          Object.assign(CH[i].style, { left: (hr.left - pr.left) + 'px', top: (hr.top - pr.top) + 'px', width: hr.width + 'px', height: hr.height + 'px' }); });
        // multiplier: baseline probe of the real label subtree, rotation removed, at the host's exact offset
        const cprops = getComputedStyle(card);
        const LM = [...card.querySelectorAll('.ticketCard__badgeHost_multiplier')], CMH = [...clone.querySelectorAll('.ticketCard__badgeHost_multiplier')];
        LM.forEach((host, i) => {
          const hr = host.getBoundingClientRect(), cr = card.getBoundingClientRect();
          const mk = (zoom) => { const wrap = document.createElement('div'); wrap.style.cssText = `position:absolute;left:0;top:0;width:${cr.width}px;height:${cr.height}px;zoom:${zoom};font-family:MB-Onest`;
            for (let k = 0; k < cprops.length; k++) { const pr = cprops.item(k); if (pr.startsWith('--')) wrap.style.setProperty(pr, cprops.getPropertyValue(pr)); }
            const hc = host.cloneNode(true); hc.className = host.className; Object.assign(hc.style, { position: 'absolute', left: (hr.left - cr.left) + 'px', top: (hr.top - cr.top) + 'px', width: hr.width + 'px', height: hr.height + 'px', backgroundImage: 'none' });
            const m = hc.querySelector('.ticketCard__multiplier'); m.style.transform = 'none';
            const val = hc.querySelector('.ticketCard__multiplierFill > span'); const mark = document.createElement('span'); mark.style.cssText = 'display:inline-block;width:0;height:0'; val.append(mark);
            wrap.append(hc); document.body.append(wrap);
            const v = { y: (mark.getBoundingClientRect().top - wrap.getBoundingClientRect().top) * devicePixelRatio, x: (mark.getBoundingClientRect().left - wrap.getBoundingClientRect().left) * devicePixelRatio }; wrap.remove(); return v; };
          const a1 = mk(1), a3 = mk(devicePixelRatio);
          const dy = a1.y - a3.y / devicePixelRatio, dx = a1.x - a3.x / devicePixelRatio;
          (window.__deltas ||= []).push({mult:[+dx.toFixed(4), +dy.toFixed(4)]});
          CMH[i].querySelector('.ticketCard__multiplier').style.transform = `rotate(-15deg) translate(${dx / d0}px, ${dy / d0}px)`;
        });
        mode = 'zoom';
      }
      const holder = document.createElement('div'); holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      holder.style.cssText = `position:relative;width:${W}px;height:${H}px;margin:0;padding:0;-webkit-text-size-adjust:none`;
      const st = document.createElement('style'); st.textContent = css; holder.append(st, clone);
      const BW = Math.round(W * d), BH = Math.round(H * d);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', BW); svg.setAttribute('height', BH);
      const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      if (mode === 'zoom') { holder.style.zoom = String(d); svg.setAttribute('viewBox', `0 0 ${BW} ${BH}`); fo.setAttribute('width', BW); fo.setAttribute('height', BH); }
      else { svg.setAttribute('viewBox', `0 0 ${W} ${H}`); fo.setAttribute('width', W); fo.setAttribute('height', H); }
      fo.append(holder); svg.append(fo);
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await img.decode();
      canvas.width = BW; canvas.height = BH;
      const c = canvas.getContext('2d'); c.clearRect(0, 0, BW, BH); c.drawImage(img, 0, 0, BW, BH);
    };
