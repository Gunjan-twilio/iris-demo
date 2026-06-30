import { useCallback } from 'react';

const DIAL_ROWS = [['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']];

function toE164(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length ? '+' + digits : '';
}

export default function OutboundDialer({ value, onChange }) {
  const append = useCallback(digit => {
    if (!/\d/.test(digit)) return; // * and # are DTMF, not valid in E.164
    onChange('+' + value.replace(/\D/g, '') + digit);
  }, [value, onChange]);

  const backspace = useCallback(() => {
    const digits = value.replace(/\D/g, '');
    onChange(digits.length > 1 ? '+' + digits.slice(0, -1) : '');
  }, [value, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 240 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="tel"
          value={value}
          onChange={e => onChange(toE164(e.target.value))}
          placeholder="+1xxxxxxxxxx"
          style={{ flex: 1, padding: '8px 10px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 6 }}
        />
        <button
          type="button"
          onClick={backspace}
          disabled={!value.length}
          style={{ padding: '0 12px', fontSize: 16, border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb', cursor: 'pointer' }}
        >⌫</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {DIAL_ROWS.flat().map(digit => (
          <button
            key={digit}
            type="button"
            onClick={() => append(digit)}
            style={{
              height: 52, fontSize: 18, fontWeight: 600,
              border: '1px solid #d1d5db', borderRadius: 8,
              background: '#f9fafb', cursor: 'pointer',
            }}
          >
            {digit}
          </button>
        ))}
      </div>
    </div>
  );
}
