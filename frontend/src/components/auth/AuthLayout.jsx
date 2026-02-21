import React from 'react';
import Footer from './Footer';

/**
 * Shared layout for auth pages (updated_auth visuals).
 * Left panel image, right panel card, Footer.
 */
export function AuthLayout({ children }) {
  return (
    <div className="min-h-screen bg-[#ffefdf] dark:bg-gray-900 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            <div className="hidden lg:flex items-center justify-center">
              <div className="w-full max-w-lg">
                <img
                  src="/auth_left.png"
                  alt="Relay"
                  className="w-full h-auto object-contain"
                  loading="eager"
                  style={{ maxHeight: '600px' }}
                />
              </div>
            </div>
            <div className="flex items-center justify-center lg:justify-start">
              <div className="w-full max-w-[440px]">
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
