import type { ReactNode } from 'react';
import { useMission } from '../state';
import { dateToHour, fmtDate, hourToDate } from '../engine/dataset';

export const Panel = ({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`panel ${className}`}>
    {title && <header className="panel-h"><h3>{title}</h3>{right}</header>}
    <div className="panel-b">{children}</div>
  </section>
);

export const Stat = ({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'ok' | 'warn' | 'bad' | 'info' }) => (
  <div className={`stat ${tone ?? ''}`}><div className="stat-l">{label}</div><div className="stat-v">{value}{unit && <span className="stat-u">{unit}</span>}</div></div>
);

export function Slider({ label, value, min, max, step = 1, onChange, unit, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; fmt?: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-l">{label}<b className="mono">{fmt ? fmt(value) : value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
    </label>
  );
}

export const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <label className="toggle"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>
);

export const Badge = ({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;
export const riskTone = (r: string) => (r === 'LOW' ? 'ok' : r === 'MODERATE' ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad';
export const scoreTone = (s: number) => (s >= 80 ? 'ok' : s >= 55 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad';

export function DateInput({ hour, onChange, label }: { hour: number; onChange: (h: number) => void; label: string }) {
  const { ds } = useMission();
  const v = hourToDate(ds, hour).toISOString().slice(0, 16);
  return (
    <label className="dateinput"><span>{label}</span>
      <input type="datetime-local" value={v} min={hourToDate(ds, 0).toISOString().slice(0, 16)} max={hourToDate(ds, ds.hours - 1).toISOString().slice(0, 16)}
        onChange={e => e.target.value && onChange(dateToHour(ds, new Date(e.target.value + 'Z')))} />
      <small className="mono">{fmtDate(hourToDate(ds, hour))}</small>
    </label>
  );
}

export function ScoreBar({ value }: { value: number }) {
  return <div className="scorebar"><div className={scoreTone(value)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>;
}

export function download(name: string, text: string, type = 'text/markdown') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
