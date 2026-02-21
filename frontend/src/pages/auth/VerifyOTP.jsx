import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/useToast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthCard } from '@/components/auth/AuthCard';
import OTPInput from '@/components/ui/OTPInput';
import LoadingButton from '@/components/ui/LoadingButton';
import { maskEmail } from '@/utils/validation';
import { verifyPasswordOTP, forgotPassword } from '@/http/password.api';

export default function VerifyOTP() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const email = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('email') || '') : '';
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const [timerKey, setTimerKey] = useState(0);

  useEffect(() => {
    if (!email) {
      setLocation('/forgot');
      return;
    }
    setResendTimer(30);
    setCanResend(false);
    const timer = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [email, setLocation, timerKey]);

  const handleOTPComplete = async (otpValue) => {
    setLoading(true);
    try {
      await verifyPasswordOTP(email, otpValue);
      toast({ title: 'Code verified.' });
      setLocation('/reset?email=' + encodeURIComponent(email) + '&otp=' + encodeURIComponent(otpValue));
    } catch (err) {
      toast({ title: err.message || 'Invalid or expired code.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setLoading(true);
    try {
      await forgotPassword(email);
      toast({ title: 'New code sent.' });
      setTimerKey((k) => k + 1);
    } catch (err) {
      toast({ title: err.message || 'Could not resend.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setLocation('/forgot');
  };

  if (!email) return null;

  return (
    <AuthLayout>
      <AuthCard title="Verify OTP" subtitle={'Code sent to ' + (email.includes('@') ? maskEmail(email) : email)}>
        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-sm text-center text-gray-600 dark:text-gray-400">
              Enter the 6-digit code sent to your email
            </p>
            <OTPInput length={6} onComplete={handleOTPComplete} disabled={loading} />
          </div>
          <div className="text-center">
            {canResend ? (
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                data-testid="resend-otp-button"
              >
                Resend OTP
              </button>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Resend in <span className="font-medium">{resendTimer}s</span>
              </p>
            )}
          </div>
          <LoadingButton type="button" onClick={handleBack} variant="secondary" disabled={loading} data-testid="otp-back-button">
            Back
          </LoadingButton>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
