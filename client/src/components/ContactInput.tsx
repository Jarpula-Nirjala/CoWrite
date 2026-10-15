import { useEffect, useId, useState, type InputHTMLAttributes } from 'react';
import { searchContacts, type Contact } from '../lib/google.ts';

/** An email field that suggests people from your Google Contacts (when Contacts is connected). */
export function ContactInput({ value, onValue, ...rest }: { value: string; onValue(v: string): void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'>) {
  const list = useId();
  const [people, setPeople] = useState<Contact[]>([]);
  // Suggest for the address being typed (after the last comma).
  const current = value.split(',').pop()?.trim() ?? '';
  useEffect(() => {
    if (current.length < 2 || current.includes('@')) return setPeople([]);
    const t = setTimeout(() => void searchContacts(current).then(setPeople), 250);
    return () => clearTimeout(t);
  }, [current]);
  const before = value.includes(',') ? `${value.slice(0, value.lastIndexOf(',') + 1)} ` : '';
  return (
    <>
      <input {...rest} value={value} onChange={(e) => onValue(e.target.value)} list={list} autoComplete="off" />
      <datalist id={list}>
        {people.map((p) => (
          <option key={p.email} value={`${before}${p.email}`}>
            {p.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
