/** Keep every part of a floating window reachable, including its close control. */
export function constrainWindow(position, size, viewport, gap = 8) {
    const width = Math.max(0, Number(size.width) || 0);
    const height = Math.max(0, Number(size.height) || 0);
    const vw = Math.max(0, Number(viewport.width) || 0);
    const vh = Math.max(0, Number(viewport.height) || 0);
    const xGap = width + gap * 2 <= vw ? gap : 0;
    const yGap = height + gap * 2 <= vh ? gap : 0;
    return {
        x: Math.min(Math.max(xGap, Number(position.x) || 0), Math.max(xGap, vw - width - xGap)),
        y: Math.min(Math.max(yGap, Number(position.y) || 0), Math.max(yGap, vh - height - yGap)),
    };
}
