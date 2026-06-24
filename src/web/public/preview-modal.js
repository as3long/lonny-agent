  /* ── Preview Modal ── */

  export function openPreview(content, title) {
    let modal = document.getElementById('preview-modal')
    if (!modal) {
      modal = document.createElement('div')
      modal.id = 'preview-modal'
      modal.className = 'modal hidden'
      modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-content">
          <div class="modal-header">
            <span class="modal-title">Preview</span>
            <button class="modal-close" id="modal-close-btn">✕</button>
          </div>
          <div class="modal-body">
            <pre><code id="modal-code"></code></pre>
          </div>
        </div>
      `
      document.body.appendChild(modal)

      modal.querySelector('.modal-backdrop').addEventListener('click', closePreview)
      modal.querySelector('#modal-close-btn').addEventListener('click', closePreview)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closePreview()
      })
    }

    modal.querySelector('.modal-title').textContent = title || 'File Preview'
    const codeEl = modal.querySelector('#modal-code')
    if (typeof hljs !== 'undefined') {
      const result = hljs.highlightAuto(content)
      codeEl.innerHTML = result.value
      codeEl.className = `hljs language-${result.language || 'plaintext'}`
    } else {
      codeEl.textContent = content
    }
    modal.classList.remove('hidden')
  }

  export function closePreview() {
    const modal = document.getElementById('preview-modal')
    if (modal) modal.classList.add('hidden')
  }