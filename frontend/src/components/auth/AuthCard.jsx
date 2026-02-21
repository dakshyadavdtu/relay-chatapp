import React from 'react';

/**
 * Auth card wrapper (updated_auth visuals). Title, subtitle, content.
 */
export function AuthCard({ title, subtitle, children }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="text-gray-600 dark:text-gray-300">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
