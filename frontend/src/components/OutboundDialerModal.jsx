import { useState } from 'react';
import OutboundDialer from './OutboundDialer.jsx';

function toE164(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length ? '+' + digits : '';
}

export default function OutboundDialerModal({ value, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="tel"
          value={value}
          onChange={e => onChange(toE164(e.target.value))}
          placeholder="+1xxxxxxxxxx"
          style={{ flex: 1, padding: '8px 10px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 6 }}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open dialpad"
          style={{
            padding: '6px 10px', fontSize: 18, border: '1px solid #d1d5db',
            borderRadius: 6, background: '#f9fafb', cursor: 'pointer', lineHeight: 1,
          }}
        >
          ⌨
        </button>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: 24,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Dial Pad</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
              >×</button>
            </div>
            <OutboundDialer value={value} onChange={onChange} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '9px 0', background: '#0071CE', color: '#fff', fontWeight: 600,
                border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
