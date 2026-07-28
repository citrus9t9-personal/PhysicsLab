const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function minimumSandboxZoom(viewport, world, floor = 0.2) {
  return Math.max(floor, viewport.width / world.width, viewport.height / world.height);
}

export function clampSandboxZoom(value, minimum = 0.2) {
  return clamp(value, minimum, 2.5);
}

export function bottomLeftSandboxCamera(viewport, world, zoom) {
  return {
    x: 0,
    y: viewport.height - world.height * zoom,
  };
}

export function screenPointToWorld(point, camera, zoom, pixelsPerUnit) {
  return {
    x: (point.x - camera.x) / (zoom * pixelsPerUnit),
    y: (point.y - camera.y) / (zoom * pixelsPerUnit),
  };
}

export function cameraForZoomAtPoint(camera, currentZoom, nextZoom, point, pixelsPerUnit, minimumZoom = 0.2) {
  const zoom = clampSandboxZoom(nextZoom, minimumZoom);
  const world = screenPointToWorld(point, camera, currentZoom, pixelsPerUnit);
  return {
    zoom,
    camera: {
      x: point.x - world.x * pixelsPerUnit * zoom,
      y: point.y - world.y * pixelsPerUnit * zoom,
    },
  };
}

export function constrainSandboxCamera(camera, viewport, world, zoom) {
  const scaledWidth = world.width * zoom;
  const scaledHeight = world.height * zoom;
  const constrainAxis = (value, viewportSize, worldSize) => {
    if (worldSize <= viewportSize) return (viewportSize - worldSize) / 2;
    return clamp(value, viewportSize - worldSize, 0);
  };
  return {
    x: constrainAxis(camera.x, viewport.width, scaledWidth),
    y: constrainAxis(camera.y, viewport.height, scaledHeight),
  };
}
