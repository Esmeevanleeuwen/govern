/** Normalize native wheel units without changing page-wide scrolling. */
export function wheelZoomDelta(event, pageHeight = 600) {
    if (!Number.isFinite(event.deltaY)) return 0;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, pageHeight) : 1;
    return Math.max(-600, Math.min(600, event.deltaY * unit));
}

/** Wheel and trackpad zoom belongs only to the diagram, anchored at the cursor. */
export function attachSchemaWheelZoom(canvas, {getZoom, setZoom}) {
    const wheel = event => {
        if (event.defaultPrevented) return;
        // Leave a future embedded input or scrollable inspector in control of its wheel.
        const control = event.target?.closest?.('input, textarea, select, [contenteditable="true"], [data-schema-scroll]');
        if (control && canvas.contains(control)) return;
        const delta = wheelZoomDelta(event, canvas.clientHeight);
        const current = getZoom();
        if (!delta || !Number.isFinite(current) || current <= 0) return;
        event.preventDefault();
        const bounds = canvas.getBoundingClientRect();
        setZoom(current * Math.exp(-delta * .002), {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
        });
    };
    canvas.addEventListener('wheel', wheel, {passive: false});
    return () => canvas.removeEventListener('wheel', wheel);
}
