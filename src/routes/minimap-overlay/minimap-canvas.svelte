<script lang="ts">
  import { onDestroy } from "svelte";
  import type { MinimapEntity, MinimapSnapshot } from "$lib/api";
  import { SETTINGS } from "$lib/settings-store";
  import { slotColor } from "./colors";
  import { minimapSkillCasts } from "./minimap-runtime.svelte.js";
  import { resolveScene } from "./scene-registry";
  import {
    emptySceneView,
    type MechanicRegion,
    type SceneView,
  } from "./scene-types";

  let { snapshot }: { snapshot: MinimapSnapshot | null } = $props();

  let canvas: HTMLCanvasElement | null = $state(null);
  let displayedSnapshot: MinimapSnapshot | null = $state(snapshot);
  let pendingSnapshot: MinimapSnapshot | null = snapshot;
  let lastSnapshotDrawnAt = 0;
  let refreshTimer: number | null = null;

  const PADDING = 10;
  // Radius of the upward triangle drawn for every non-team entity. Larger than
  // team-member circles so mechanic entities (orbs, etc.) read clearly.
  const NON_TEAM_TRIANGLE_RADIUS = 10;
  const DEFAULT_BOSS_COLOR = "#ef4444";
  const DEFAULT_LOCAL_RING_COLOR = "#ffffff";
  const DEFAULT_LOCAL_RING_WIDTH = 2;
  const minimapSettings = $derived(SETTINGS.minimap.state);

  type Projector = (x: number, z: number) => [number, number];

  function displayName(entity: MinimapEntity): string {
    return entity.name ?? entity.entityUuid;
  }

  const sceneView = $derived.by<SceneView>(() => {
    if (!displayedSnapshot) return emptySceneView();
    const scene = resolveScene(displayedSnapshot.sceneId);
    return (
      scene?.resolveView(displayedSnapshot, displayName, minimapSkillCasts()) ??
      emptySceneView(displayedSnapshot.entities, displayedSnapshot.markers)
    );
  });

  const aspect = $derived.by(() => {
    const { halfForHeight, halfForWidth } = rotatedHalfExtents(sceneView);
    return halfForHeight / halfForWidth;
  });

  function mapRefreshRateMs(): number {
    const value = Number(minimapSettings.mapRefreshRateMs ?? 500);
    return Number.isFinite(value) ? Math.max(50, Math.min(2000, value)) : 500;
  }

  function clearRefreshTimer() {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function applyPendingSnapshot(now = Date.now()) {
    clearRefreshTimer();
    displayedSnapshot = pendingSnapshot;
    lastSnapshotDrawnAt = now;
  }

  function queueSnapshotForMap(nextSnapshot: MinimapSnapshot | null) {
    pendingSnapshot = nextSnapshot;
    if (typeof window === "undefined") {
      displayedSnapshot = nextSnapshot;
      return;
    }

    if (nextSnapshot === null) {
      clearRefreshTimer();
      displayedSnapshot = null;
      lastSnapshotDrawnAt = 0;
      return;
    }

    const changedScene =
      displayedSnapshot?.sceneId !== nextSnapshot.sceneId ||
      displayedSnapshot?.localPlayerUuid !== nextSnapshot.localPlayerUuid;
    if (lastSnapshotDrawnAt === 0 || changedScene) {
      applyPendingSnapshot();
      return;
    }

    const now = Date.now();
    const remainingMs = mapRefreshRateMs() - (now - lastSnapshotDrawnAt);
    if (remainingMs <= 0) {
      applyPendingSnapshot(now);
      return;
    }

    clearRefreshTimer();
    refreshTimer = window.setTimeout(() => applyPendingSnapshot(), remainingMs);
  }

  function normalizedRotationQuarters(rotationQuarters: number): number {
    return ((Math.trunc(rotationQuarters) % 4) + 4) % 4;
  }

  function rotatedHalfExtents(view: SceneView): {
    halfForWidth: number;
    halfForHeight: number;
  } {
    const isQuarterTurn =
      normalizedRotationQuarters(view.rotationQuarters) % 2 === 1;
    return {
      halfForWidth: isQuarterTurn ? view.worldHalfX : view.worldHalfZ,
      halfForHeight: isQuarterTurn ? view.worldHalfZ : view.worldHalfX,
    };
  }

  function rotateMapPoint(x: number, z: number, rotationQuarters: number) {
    switch (normalizedRotationQuarters(rotationQuarters)) {
      case 1:
        return { x: -z, z: x };
      case 2:
        return { x: -x, z: -z };
      case 3:
        return { x: z, z: -x };
      default:
        return { x, z };
    }
  }

  function localEntityFor(view: SceneView): MinimapEntity | null {
    const localUuid = displayedSnapshot?.localPlayerUuid;
    return (
      view.entities.find((entity) => entity.kind === "local") ??
      view.entities.find((entity) => entity.entityUuid === localUuid) ??
      null
    );
  }

  function mapScreenRotationRad(view: SceneView): number {
    if (minimapSettings.mapOrientation !== "player-facing") return 0;

    const localEntity = localEntityFor(view);
    const facing = localEntity?.facing;
    if (facing === null || facing === undefined || !Number.isFinite(facing)) {
      return 0;
    }

    const rad = (facing * Math.PI) / 180;
    const facingVector = rotateMapPoint(
      Math.sin(rad),
      Math.cos(rad),
      view.rotationQuarters,
    );
    const screenDx = -facingVector.z;
    const screenDy = -facingVector.x;
    if (screenDx === 0 && screenDy === 0) return 0;
    return -Math.PI / 2 - Math.atan2(screenDy, screenDx);
  }

  function makeProjector(
    w: number,
    h: number,
    view: SceneView,
  ): { project: Projector; scale: number } {
    const { halfForWidth, halfForHeight } = rotatedHalfExtents(view);
    const screenRotation = mapScreenRotationRad(view);
    const cos = Math.cos(screenRotation);
    const sin = Math.sin(screenRotation);
    const absCos = Math.abs(cos);
    const absSin = Math.abs(sin);
    const rotatedHalfForWidth = absCos * halfForWidth + absSin * halfForHeight;
    const rotatedHalfForHeight = absSin * halfForWidth + absCos * halfForHeight;
    const scaleX = (w - PADDING * 2) / (rotatedHalfForWidth * 2);
    const scaleY = (h - PADDING * 2) / (rotatedHalfForHeight * 2);
    const scale = Math.min(scaleX, scaleY);
    const cx = w / 2;
    const cy = h / 2;
    return {
      project: (x, z) => {
        const point = rotateMapPoint(x, z, view.rotationQuarters);
        const baseX = -point.z * scale;
        const baseY = -point.x * scale;
        return [
          cx + baseX * cos - baseY * sin,
          cy + baseX * sin + baseY * cos,
        ];
      },
      scale,
    };
  }

  function colorFor(entity: MinimapEntity): string {
    const colors = minimapSettings.entityColors;
    if (entity.kind === "boss") return colors.boss ?? DEFAULT_BOSS_COLOR;
    return entity.kind === "local" ? colors.local : colors.teammate;
  }

  function whitelistEntryFor(entity: MinimapEntity) {
    if (entity.kind !== "teammate" && entity.kind !== "local") return null;
    const entityUid = entity.entityUuid.trim();
    if (!entityUid) return null;
    return (
      minimapSettings.playerWhitelist?.find(
        (entry) => entry.enabled !== false && entry.uid.trim() === entityUid,
      ) ?? null
    );
  }

  function shouldForceShowPlayer(
    entity: MinimapEntity,
    whitelistEntry: ReturnType<typeof whitelistEntryFor>,
  ): boolean {
    if (entity.kind !== "teammate" && entity.kind !== "local") return false;
    return minimapSettings.alwaysShowPlayers === true || whitelistEntry !== null;
  }

  function radiusFor(): number {
    return 4;
  }

  function isTeamMember(entity: MinimapEntity): boolean {
    return entity.kind === "local" || entity.kind === "teammate";
  }

  function localRingWidth(): number {
    const width = Number(
      minimapSettings.localRing?.width ?? DEFAULT_LOCAL_RING_WIDTH,
    );
    return Number.isFinite(width) ? Math.max(1, Math.min(6, width)) : 2;
  }

  function shouldDrawLocalRing(): boolean {
    return minimapSettings.localRing?.enabled !== false;
  }

  function drawLocalRing(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    if (!shouldDrawLocalRing()) return;

    const width = localRingWidth();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.strokeStyle =
      minimapSettings.localRing?.color ?? DEFAULT_LOCAL_RING_COLOR;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusFor() + width, 0, Math.PI * 2);
    ctx.stroke();
  }

  function shouldDrawLocalFacing(): boolean {
    return minimapSettings.localFacing?.enabled === true;
  }

  function drawLocalFacing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    entity: MinimapEntity,
    project: Projector,
    color: string,
  ) {
    if (!shouldDrawLocalFacing()) return;
    const facing = entity.facing;
    if (facing === null || facing === undefined || !Number.isFinite(facing)) {
      return;
    }

    const rad = (facing * Math.PI) / 180;
    const [aheadX, aheadY] = project(
      entity.x + Math.sin(rad),
      entity.z + Math.cos(rad),
    );
    const dx = aheadX - cx;
    const dy = aheadY - cy;
    if (dx === 0 && dy === 0) return;
    const heading = Math.atan2(dy, dx);

    const base =
      radiusFor() + (shouldDrawLocalRing() ? localRingWidth() : 0) + 3;
    const length = 7;
    const halfWidth = 4;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.translate(cx, cy);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(base + length, 0);
    ctx.lineTo(base, -halfWidth);
    ctx.lineTo(base, halfWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Upward-pointing triangle centered on (cx, cy), used for every non-team
  // entity so it reads distinctly from team members' circles.
  function drawTriangle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.866, cy + r * 0.5);
    ctx.lineTo(cx - r * 0.866, cy + r * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  function traceProjectedPolygon(
    ctx: CanvasRenderingContext2D,
    points: [number, number][],
  ) {
    const [firstX, firstY] = points[0] ?? [0, 0];
    ctx.beginPath();
    ctx.moveTo(firstX, firstY);
    for (const [x, y] of points.slice(1)) {
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function draw() {
    const el = canvas;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = el.clientWidth || 360;
    const cssH = el.clientHeight || Math.round(cssW / aspect);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (el.width !== pxW || el.height !== pxH) {
      el.width = pxW;
      el.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.fillStyle = "rgba(15, 23, 42, 0.68)";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = "rgba(203, 213, 225, 0.72)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cssW - 2, cssH - 2);

    const view = sceneView;
    const { project, scale } = makeProjector(cssW, cssH, view);
    const [ox, oy] = project(0, 0);

    if (view.layout.squares.length > 0) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.lineWidth = 1;
      for (const half of view.layout.squares) {
        traceProjectedPolygon(ctx, [
          project(-half, -half),
          project(half, -half),
          project(half, half),
          project(-half, half),
        ]);
        ctx.stroke();
      }
    }

    if (view.layout.circles.length > 0) {
      ctx.strokeStyle = "rgba(226, 232, 240, 0.85)";
      ctx.lineWidth = 1.5;
      for (const r of view.layout.circles) {
        ctx.beginPath();
        ctx.arc(ox, oy, r * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (view.layout.lines.length > 0) {
      ctx.strokeStyle = "rgba(226, 232, 240, 0.9)";
      ctx.lineWidth = 2;
      for (const line of view.layout.lines) {
        const [sx, sy] = project(line.x1, line.z1);
        const [ex, ey] = project(line.x2, line.z2);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }

    for (const region of view.regions) {
      drawRegion(ctx, region, project, scale, ox, oy);
    }

    for (const entity of view.entities) {
      if (entity.kind === "boss" && minimapSettings.showBoss !== true) {
        continue;
      }

      const colorSlot = view.entityColorSlots.get(entity.entityUuid);
      const hasMechanic = colorSlot !== undefined;
      const whitelistEntry = whitelistEntryFor(entity);
      if (
        minimapSettings.hideNormalTeammates &&
        entity.kind === "teammate" &&
        !hasMechanic &&
        !shouldForceShowPlayer(entity, whitelistEntry)
      ) {
        continue;
      }

      const [sx, sy] = project(entity.x, entity.z);
      const team = isTeamMember(entity);
      const dotColor =
        colorSlot === undefined
          ? whitelistEntry?.color ?? colorFor(entity)
          : slotColor(colorSlot);

      ctx.globalAlpha = entity.isDead
        ? 0.35
        : hasMechanic || entity.kind !== "other"
          ? 1
          : 0.45;
      if (hasMechanic || whitelistEntry) {
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = hasMechanic ? 12 : 8;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = dotColor;
      if (team) {
        ctx.beginPath();
        ctx.arc(sx, sy, radiusFor(), 0, Math.PI * 2);
        ctx.fill();
        if (entity.kind === "local") {
          drawLocalRing(ctx, sx, sy);
          drawLocalFacing(ctx, sx, sy, entity, project, colorFor(entity));
        }
      } else {
        drawTriangle(ctx, sx, sy, NON_TEAM_TRIANGLE_RADIUS);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    drawMarkers(ctx, project, view.markers);
  }

  function drawMarkers(
    ctx: CanvasRenderingContext2D,
    project: Projector,
    markers: SceneView["markers"],
  ) {
    if (!minimapSettings.showMarkers) return;
    if (!markers || markers.length === 0) return;

    const colors = minimapSettings.markerColors as
      | Record<string, string>
      | undefined;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.font = "700 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000000";
    ctx.lineJoin = "round";
    for (const marker of markers) {
      if (
        marker.x === null ||
        marker.x === undefined ||
        marker.z === null ||
        marker.z === undefined
      ) {
        continue;
      }
      const markerNumber = marker.marker;
      if (markerNumber < 1 || markerNumber > 6) continue;
      const [sx, sy] = project(marker.x, marker.z);
      const label = String(markerNumber);
      ctx.strokeText(label, sx, sy);
      ctx.fillStyle = colors?.[`m${markerNumber}`] ?? "#ffffff";
      ctx.fillText(label, sx, sy);
    }
    ctx.restore();
  }

  function fillRectRegion(
    ctx: CanvasRenderingContext2D,
    project: Projector,
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    color: string,
  ) {
    const points = [
      project(cx - halfX, cz - halfZ),
      project(cx + halfX, cz - halfZ),
      project(cx + halfX, cz + halfZ),
      project(cx - halfX, cz + halfZ),
    ];
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    traceProjectedPolygon(ctx, points);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawSectorRegion(
    ctx: CanvasRenderingContext2D,
    project: Projector,
    region: Extract<MechanicRegion, { kind: "sector" }>,
    color: string,
  ) {
    const steps = Math.max(
      6,
      Math.ceil(Math.abs(region.endDeg - region.startDeg) / 8),
    );
    const points: [number, number][] = [project(region.x, region.z)];
    for (let i = 0; i <= steps; i++) {
      const deg =
        region.startDeg + ((region.endDeg - region.startDeg) * i) / steps;
      const rad = (deg * Math.PI) / 180;
      points.push(
        project(
          region.x + Math.sin(rad) * region.radius,
          region.z + Math.cos(rad) * region.radius,
        ),
      );
    }

    ctx.beginPath();
    const [startX, startY] = points[0] ?? [0, 0];
    ctx.moveTo(startX, startY);
    for (const [x, y] of points.slice(1)) {
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawPolygonRegion(
    ctx: CanvasRenderingContext2D,
    project: Projector,
    region: Extract<MechanicRegion, { kind: "polygon" }>,
    color: string,
  ) {
    if (region.points.length < 3) return;

    const points = region.points.map((point) => project(point.x, point.z));
    ctx.beginPath();
    const [startX, startY] = points[0] ?? [0, 0];
    ctx.moveTo(startX, startY);
    for (const [x, y] of points.slice(1)) {
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawLineRegion(
    ctx: CanvasRenderingContext2D,
    project: Projector,
    region: Extract<MechanicRegion, { kind: "line" }>,
    color: string,
  ) {
    const [sx, sy] = project(region.x1, region.z1);
    const [ex, ey] = project(region.x2, region.z2);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = region.widthPx ?? 2;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    if (region.label) {
      ctx.fillStyle = color;
      ctx.font = "700 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(region.label, (sx + ex) / 2, (sy + ey) / 2);
    }
    ctx.restore();
  }

  function drawRegion(
    ctx: CanvasRenderingContext2D,
    region: MechanicRegion,
    project: Projector,
    scale: number,
    ox: number,
    oy: number,
  ) {
    const color = slotColor(region.colorSlot);
    if (region.kind === "ring") {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ox, oy, region.rOuter * scale, 0, Math.PI * 2);
      ctx.arc(ox, oy, region.rInner * scale, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ox, oy, region.rOuter * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    if (region.kind === "line") {
      drawLineRegion(ctx, project, region, color);
      return;
    }

    if (region.kind === "sector") {
      drawSectorRegion(ctx, project, region, color);
      if (region.label) {
        const midDeg = (region.startDeg + region.endDeg) / 2;
        const rad = (midDeg * Math.PI) / 180;
        const [tx, ty] = project(
          region.x + Math.sin(rad) * region.radius * 0.62,
          region.z + Math.cos(rad) * region.radius * 0.62,
        );
        ctx.fillStyle = color;
        ctx.font = "700 14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(region.label, tx, ty);
      }
      return;
    }

    if (region.kind === "polygon") {
      if (region.points.length < 3) return;
      drawPolygonRegion(ctx, project, region, color);
      if (region.label) {
        const centroid = polygonCentroid(region.points);
        const [tx, ty] = project(centroid.x, centroid.z);
        ctx.fillStyle = color;
        ctx.font = "700 14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(region.label, tx, ty);
      }
      return;
    }

    fillRectRegion(
      ctx,
      project,
      region.x,
      region.z,
      region.halfX,
      region.halfZ,
      color,
    );
    if (region.label) {
      const [tx, ty] = project(region.x, region.z);
      ctx.fillStyle = color;
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(region.label, tx, ty);
    }
  }

  function polygonCentroid(points: { x: number; z: number }[]): {
    x: number;
    z: number;
  } {
    if (points.length === 0) return { x: 0, z: 0 };
    const sum = points.reduce(
      (acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }),
      { x: 0, z: 0 },
    );
    return {
      x: sum.x / points.length,
      z: sum.z / points.length,
    };
  }

  $effect(() => {
    void minimapSettings.mapRefreshRateMs;
    queueSnapshotForMap(snapshot);
  });

  $effect(() => {
    void displayedSnapshot;
    void snapshot;
    void aspect;
    void sceneView;
    void minimapSettings.mapOrientation;
    void minimapSettings.hideNormalTeammates;
    void minimapSettings.showBoss;
    void minimapSettings.showMarkers;
    void minimapSettings.alwaysShowPlayers;
    void minimapSettings.playerWhitelist;
    void minimapSettings.markerColors;
    void minimapSettings.entityColors.local;
    void minimapSettings.entityColors.teammate;
    void minimapSettings.entityColors.boss;
    void minimapSettings.localRing?.enabled;
    void minimapSettings.localRing?.color;
    void minimapSettings.localRing?.width;
    void minimapSettings.localFacing?.enabled;
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(id);
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      clearRefreshTimer();
    }
  });
</script>

<canvas bind:this={canvas} class="minimap-canvas" style="aspect-ratio: {aspect}"
></canvas>

<style>
  .minimap-canvas {
    width: 100%;
    display: block;
    border-radius: 14px;
    box-shadow:
      0 16px 44px rgba(15, 23, 42, 0.28),
      inset 0 1px 0 rgba(248, 250, 252, 0.06);
  }
</style>
