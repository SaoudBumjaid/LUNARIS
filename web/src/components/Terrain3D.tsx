import { useMemo, useRef } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useMission } from '../state';
import { idx, rc } from '../engine/dataset';
import { layerColors, type LayerKey } from '../engine/layers';
import type { Step } from '../engine/planner';

function dirFromAzEl(az: number, el: number, dist: number): [number, number, number] {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  // world: x = grid +x, z = -grid +y (so grid north is "into" the screen), y = up
  return [dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e), -dist * Math.cos(e) * Math.cos(a)];
}

function TerrainMesh({ layer, hour, exag, onPick }: { layer: LayerKey; hour: number; exag: number; onPick: (c: number) => void }) {
  const { ds } = useMission();
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(ds.W * ds.cell, ds.H * ds.cell, ds.W - 1, ds.H - 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [ds]);
  useMemo(() => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const mid = (ds.elevMax + ds.elevMin) / 2;
    for (let i = 0; i < ds.N; i++) pos.setY(i, (ds.elev[i] - mid) * exag);
    pos.needsUpdate = true; geo.computeVertexNormals();
  }, [geo, ds, exag]);
  useMemo(() => {
    const col = layerColors(ds, layer, hour);
    const arr = new Float32Array(ds.N * 3); for (let i = 0; i < arr.length; i++) arr[i] = col[i] / 255;
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }, [geo, ds, layer, hour]);
  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation(); const p = e.point;
    const c = Math.round(p.x / ds.cell + (ds.W - 1) / 2), r = Math.round(p.z / ds.cell + (ds.H - 1) / 2);
    if (r >= 0 && c >= 0 && r < ds.H && c < ds.W) onPick(idx(ds, r, c));
  };
  return (
    <mesh geometry={geo} onDoubleClick={pick} receiveShadow castShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  );
}

export function Terrain3D({ layer, hour, exag, routes, onPick }: { layer: LayerKey; hour: number; exag: number; routes: { steps: Step[]; color: string }[]; onPick: (c: number) => void }) {
  const m = useMission(); const ds = m.ds;
  const span = Math.max(ds.W, ds.H) * ds.cell;
  const t = Math.min(ds.hours - 1, Math.max(0, Math.floor(hour)));
  const sunPos = dirFromAzEl(ds.ephem.sunAz[t], Math.max(ds.ephem.sunEl[t], 0.5), span);
  const earthPos = dirFromAzEl(ds.ephem.earthAz[t], ds.ephem.earthEl[t] + 2, span * 2.5);
  const mid = (ds.elevMax + ds.elevMin) / 2;
  const P = (cell: number, lift = 12): [number, number, number] => {
    const [r, c] = rc(ds, cell); return [(c - (ds.W - 1) / 2) * ds.cell, (ds.elev[cell] - mid) * exag + lift, (r - (ds.H - 1) / 2) * ds.cell];
  };
  const ctl = useRef(null);
  return (
    <Canvas camera={{ position: [span * 0.55, span * 0.45, span * 0.75], fov: 42, near: 10, far: span * 20 }} shadows>
      <color attach="background" args={['#05070B']} />
      <Stars radius={span * 6} depth={span} count={3000} factor={span / 60} fade />
      <ambientLight intensity={1.6} />
      <directionalLight position={sunPos} intensity={1.0} color="#fff4dc" />
      <mesh position={earthPos}><sphereGeometry args={[span * 0.06, 32, 32]} /><meshStandardMaterial color="#3b82c4" emissive="#1e3a5f" emissiveIntensity={0.8} /></mesh>
      <TerrainMesh layer={layer} hour={hour} exag={exag} onPick={onPick} />
      {m.sites.map(s => { const p = P(idx(ds, s.cell[0], s.cell[1]), 60 * exag); return (
        <mesh key={s.id} position={p}><coneGeometry args={[span * 0.006, span * 0.02, 12]} /><meshBasicMaterial color={s.id === m.siteId ? '#E8B85C' : '#C7CBD1'} /></mesh>); })}
      {ds.meta.targets.map(tg => { const p = P(idx(ds, tg.centroid[0], tg.centroid[1]), 40 * exag); return (
        <mesh key={tg.id} position={p}><octahedronGeometry args={[span * 0.007]} /><meshBasicMaterial color="#A78BFA" /></mesh>); })}
      {routes.filter(r => r.steps.length > 1).map((r, k) => <Line key={k} points={r.steps.map(s => P(s.cell, 15 * exag))} color={r.color} lineWidth={3} />)}
      <OrbitControls ref={ctl} enableDamping maxPolarAngle={Math.PI * 0.49} minDistance={span * 0.05} maxDistance={span * 3} />
    </Canvas>
  );
}
