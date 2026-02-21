import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingButton = ({ children, loading = false, loadingText = 'Loading...', disabled = false, className = '', variant = 'primary', ...props }) => {
  const baseStyles = 'w-full px-4 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white'
  };
  return (
    <button disabled={disabled || loading} className={baseStyles + ' ' + (variants[variant] || variants.primary) + ' ' + className} {...props}>
      {loading && <Loader2 className="animate-spin" size={18} />}
      <span>{loading ? loadingText : children}</span>
    </button>
  );
};
export default LoadingButton;
