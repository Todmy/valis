/**
 * T033: Search bar component with type-ahead support.
 */

'use client';

import { useState, type FormEvent } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
}

export function SearchBar({ onSearch, placeholder = 'Search decisions...', initialValue = '' }: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSearch(query.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Type-ahead: search on every keystroke if query is 3+ chars
          if (e.target.value.trim().length >= 3) {
            onSearch(e.target.value.trim());
          }
        }}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-brand-600 text-white rounded-md font-medium hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
      >
        Search
      </button>
    </form>
  );
}
