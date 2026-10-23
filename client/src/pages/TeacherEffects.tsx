import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ElementType, type PointerEvent, type ReactNode } from 'react';

export function pointerEffectsAllowed(reducedMotion: boolean, hoverAvailable: boolean) {
  return !reducedMotion && hoverAvailable;
}

function usePointerEffects() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setEnabled(pointerEffectsAllowed(motion.matches, hover.matches));
    update();
    motion.addEventListener('change', update);
    hover.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      hover.removeEventListener('change', update);
    };
  }, []);
  return enabled;
}

export function TiltCard({ as = 'div', className = '', children, ...props }: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const Component = as;
  const ref = useRef<HTMLElement | null>(null);
  const enabled = usePointerEffects();
  const frame = useRef<number | null>(null);
  const bounds = useRef<DOMRect | null>(null);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType !== 'mouse' || !ref.current || ref.current.querySelector('table')) return;
    bounds.current = ref.current.getBoundingClientRect();
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = bounds.current;
    const element = ref.current;
    if (!enabled || !rect || !element || element.querySelector('table') || event.pointerType !== 'mouse') return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      element.style.setProperty('--teacher-rotate-x', `${(0.5 - y) * 18}deg`);
      element.style.setProperty('--teacher-rotate-y', `${(x - 0.5) * 20}deg`);
      element.style.setProperty('--teacher-spot-x', `${x * 100}%`);
      element.style.setProperty('--teacher-spot-y', `${y * 100}%`);
    });
  };
  const reset = () => {
    bounds.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const element = ref.current;
    if (element) {
      element.style.setProperty('--teacher-rotate-x', '0deg');
      element.style.setProperty('--teacher-rotate-y', '0deg');
      element.style.setProperty('--teacher-spot-x', '50%');
      element.style.setProperty('--teacher-spot-y', '50%');
    }
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  return <Component ref={ref} className={`teacher-tilt-card ${className}`} onPointerEnter={onPointerEnter} onPointerMove={onPointerMove} onPointerLeave={reset} {...props}>
    <div className="teacher-tilt-content">{children}</div>
  </Component>;
}

export function MagneticButton({ className = '', children, onPointerEnter, onPointerMove, onPointerLeave, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const enabled = usePointerEffects();
  const frame = useRef<number | null>(null);
  const bounds = useRef<DOMRect | null>(null);
  const enter = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerEnter?.(event);
    if (enabled && event.pointerType === 'mouse' && ref.current) bounds.current = ref.current.getBoundingClientRect();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event);
    const rect = bounds.current;
    const element = ref.current;
    if (!enabled || !rect || !element || event.pointerType !== 'mouse') return;
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * rect.width * 0.18;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * rect.height * 0.28;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      element.style.setProperty('--teacher-magnetic-x', `${x}px`);
      element.style.setProperty('--teacher-magnetic-y', `${y}px`);
    });
  };
  const leave = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event);
    bounds.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    ref.current?.style.setProperty('--teacher-magnetic-x', '0px');
    ref.current?.style.setProperty('--teacher-magnetic-y', '0px');
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return <button ref={ref} className={`teacher-magnetic-button ${className}`} onPointerEnter={enter} onPointerMove={move} onPointerLeave={leave} {...props}>{children}</button>;
}

export function AnimatedCount({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) { setDisplay(target); return; }
    setDisplay(0);
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 850);
      setDisplay(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{display}</>;
}
