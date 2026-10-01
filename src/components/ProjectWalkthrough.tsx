import { ArrowRight, BookOpen, Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { walkthroughSteps, type WalkthroughStepId } from '../walkthrough/defaultProject';

type Props = {
  stepId: WalkthroughStepId;
  canContinue: boolean;
  onContinue: () => void;
  onClose: () => void;
};
type Rect = { x: number; y: number; width: number; height: number };

export function ProjectWalkthrough({ stepId, canContinue, onContinue, onClose }: Props) {
  const index = walkthroughSteps.findIndex((step) => step.id === stepId);
  const step = walkthroughSteps[index];
  const [rects, setRects] = useState<Rect[]>([]);
  const footerRef = useRef<HTMLElement>(null);
  const maskId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const footer = footerRef.current!;
    const app = footer.closest<HTMLElement>('.app')!;
    const resize = new ResizeObserver(() => app.style.setProperty('--walkthrough-height', `${footer.offsetHeight}px`));
    resize.observe(footer);
    return () => { resize.disconnect(); app.style.removeProperty('--walkthrough-height'); };
  }, []);

  useEffect(() => {
    let frame: number;
    let previous = '';
    const targets = () => step.targets.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
    const allowed = (target: EventTarget | null) => target instanceof Element &&
      (Boolean(target.closest('[data-tour="coach"]')) || step.targets.some((selector) => target.closest(selector)));

    // Measure in screen coordinates so holes follow React Flow zoom and node dragging.
    function measure() {
      const next = targets().map((target) => {
        const bounds = target.getBoundingClientRect();
        return { x: bounds.x - 5, y: bounds.y - 5, width: bounds.width + 10, height: bounds.height + 10 };
      }).filter((rect) => rect.width > 10 && rect.height > 10);
      const signature = JSON.stringify(next);
      if (signature !== previous) { setRects(next); previous = signature; }
      frame = requestAnimationFrame(measure);
    }

    function blockOutside(event: Event) {
      if (allowed(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]'))
          .filter((element) => allowed(element) && !element.matches(':disabled') && element.getClientRects().length);
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        event.stopImmediatePropagation();
        controls[next]?.focus();
        return;
      }
      const editing = event.target instanceof Element && event.target.matches('input, textarea, select');
      if (!allowed(event.target) || (!editing && ['Backspace', 'Delete'].includes(event.key)) || ((event.metaKey || event.ctrlKey) && !editing)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function keepFocus(event: FocusEvent) {
      if (!allowed(event.target)) footerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }

    const blockedEvents = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu', 'dragstart', 'drop', 'wheel'];
    blockedEvents.forEach((type) => document.addEventListener(type, blockOutside, { capture: true, passive: false }));
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', keepFocus, true);
    frame = requestAnimationFrame(measure);
    const scrollTimer = window.setTimeout(() => {
      targets()[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!allowed(document.activeElement)) footerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(scrollTimer);
      blockedEvents.forEach((type) => document.removeEventListener(type, blockOutside, true));
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', keepFocus, true);
    };
  }, [step]);

  return (
    <>
      <svg className="walkthrough-shade" aria-hidden="true" width="100%" height="100%">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {rects.map((rect, i) => <rect key={i} {...rect} rx="8" fill="black" />)}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.68)" mask={`url(#${maskId})`} />
        {rects.map((rect, i) => <rect key={i} {...rect} rx="8" fill="none" stroke="#f5f5f5" strokeWidth="2" />)}
      </svg>
      <section className="walkthrough-coach" ref={footerRef} data-tour="coach" aria-label="Default project walkthrough">
        <div className="walkthrough-copy" aria-live="polite" aria-atomic="true">
          <p className="walkthrough-progress"><BookOpen size={14} /> Default project <span>{index + 1} / {walkthroughSteps.length}</span></p>
          <h2>{step.title}</h2>
          <p>{step.description}</p>
          <p className="walkthrough-instruction">{step.instruction}</p>
        </div>
        <div className="walkthrough-actions">
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close walkthrough" title="Close and reset practice board"><X size={18} /></button>
          {'nextLabel' in step && <button type="button" className="primary walkthrough-next" disabled={!canContinue} onClick={onContinue}>{step.nextLabel}{stepId === 'complete' ? <Check size={16} /> : <ArrowRight size={16} />}</button>}
        </div>
      </section>
    </>
  );
}
