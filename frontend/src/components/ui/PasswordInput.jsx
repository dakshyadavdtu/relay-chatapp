import React, { useState, forwardRef } from 'react';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { getPasswordStrength } from '@/utils/validation';

const PasswordInput = forwardRef(({ label, error, showStrength = false, value = '', className = '', ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const { strength, score } = getPasswordStrength(value);
  const strengthColors = { weak: 'bg-red-500', medium: 'bg-yellow-500', strong: 'bg-green-500' };

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={props.id} className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {label}
        </Label>
      )}
      <div className="relative">
        <input
          ref={ref}
          type={showPassword ? 'text' : 'password'}
          value={value}
          className={'w-full px-4 py-2.5 pr-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed ' + (error ? 'border-red-500 focus:ring-red-500 ' : '') + className}
          {...props}
        />
        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" tabIndex={-1}>
          {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
      {showStrength && value && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {[1, 2, 3].map((level) => (
              <div key={level} className={'h-1 flex-1 rounded-full transition-colors ' + (level <= score ? strengthColors[strength] : 'bg-gray-200 dark:bg-gray-600')} />
            ))}
          </div>
          {strength !== 'none' && (
            <p className={'text-xs ' + (strength === 'weak' ? 'text-red-600 dark:text-red-400' : strength === 'medium' ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400')}>
              {strength === 'weak' && 'Enter a strong password'}
              {strength === 'medium' && 'Password strength: Medium'}
              {strength === 'strong' && 'Password strength: Strong'}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
export default PasswordInput;
