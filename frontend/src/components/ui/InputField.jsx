import React, { forwardRef } from 'react';
import { Label } from '@/components/ui/label';

const InputField = forwardRef(({ label, error, type = 'text', className = '', ...props }, ref) => {
  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={props.id} className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {label}
        </Label>
      )}
      <input
        ref={ref}
        type={type}
        className={'w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed ' + (error ? 'border-red-500 focus:ring-red-500 ' : '') + className}
        {...props}
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
});
InputField.displayName = 'InputField';
export default InputField;
