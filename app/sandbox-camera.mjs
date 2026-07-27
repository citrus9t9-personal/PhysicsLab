const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function clampSandboxZoom(value) {
  return clamp(value, 0.2, 2.5);
}

export function screenPointToWorld(point, camera, zoom, pixelsPerUnit) {
  return {
    x: (point.x - camera.x) / (zoom * pixelsPerUnit),
    y: (point.y - camera.y) / (zoom * pixelsPerUnit),
  };
}

export function cameraForZoomAtPoint(camera, currentZoom, nextZoom, point, pixelsPerUnit) {
  const zoom = clampSandboxZoom(nextZoom);
  const world = screenPointToWorld(point, camera, currentZoom, pixelsPerUnit);
  return {
    zoom,
    camera: {
      x: point.x - world.x * pixelsPerUnit * zoom,
      y: point.y - world.y * pixelsPerUnit * zoom,
    },
  };
}

export function constrainSandboxCamera(camera, viewport, world, zoom, edge = 72) {
  const scaledWidth = world.width * zoom;
  const scaledHeight = world.height * zoom;
  const constrainAxis = (value, viewportSize, worldSize) => {
    if (worldSize <= viewportSize) return (viewportSize - worldSize) / 2;
    return clamp(value, viewportSize - worldSize - edge, edge);
  };
  return {
    x: constrainAxis(camera.x, viewport.width, scaledWidth),
    y: constrainAxis(camera.y, viewport.height, scaledHeight),
  };
}
