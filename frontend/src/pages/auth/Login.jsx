import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/useToast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthCard } from '@/components/auth/AuthCard';
import InputField from '@/components/ui/InputField';
import PasswordInput from '@/components/ui/PasswordInput';
import LoadingButton from '@/components/ui/LoadingButton';
import { useAuth } from '@/hooks/useAuth';
import { setAuthState } from '@/state/auth.state';

function getNextPath() {
  const next = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('next');
  return next && next.startsWith('/') ? next : '/chat';
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login, loginError } = useAuth();
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [pending, setPending] = useState(false);

  const search = typeof window !== 'undefined' ? window.location.search : '';
  const reason = new URLSearchParams(search).get('reason');
  const showSessionSwitchedBanner = reason === 'session_switched';

  useEffect(() => {
    if (showSessionSwitchedBanner) setAuthState({ sessionSwitched: false });
  }, [showSessionSwitchedBanner]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      setErrors((prev) => ({ ...prev, [name]: !value.trim() ? (name === 'username' ? 'Username or email is required' : 'Password is required') : '' }));
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: !value.trim() ? (name === 'username' ? 'Username or email is required' : 'Password is required') : '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pending) return;
    setTouched({ username: true, password: true });
    const usernameError = !formData.username.trim() ? 'Username or email is required' : '';
    const passwordError = !formData.password ? 'Password is required' : '';
    setErrors({ username: usernameError, password: passwordError });
    if (usernameError || passwordError) return;

    setPending(true);
    try {
      await login({ username: formData.username.trim(), password: formData.password });
      toast({ title: 'Welcome back!' });
      setLocation(getNextPath());
    } catch {
      // error in loginError
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      {showSessionSwitchedBanner && (
        <div
          className="mb-4 p-3 rounded-lg bg-amber-500/15 border border-amber-500/50 text-amber-800 dark:text-amber-200 text-sm"
          role="alert"
        >
          Another account was used in another tab. Please sign in again to continue.
        </div>
      )}
      <AuthCard title="Welcome to Relay!" subtitle="Fast, reliable, real-time messaging.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <InputField
            id="username"
            name="username"
            type="text"
            label="Username or Email"
            placeholder="Enter username or email"
            value={formData.username}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.username && errors.username}
            disabled={pending}
            data-testid="login-username-input"
          />
          <PasswordInput
            id="password"
            name="password"
            label="Password"
            placeholder="Enter your password"
            value={formData.password}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.password && errors.password}
            disabled={pending}
            data-testid="login-password-input"
          />
          <div className="text-right">
            <Link href="/forgot" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" data-testid="login-forgot-password-link">
              Forgot password?
            </Link>
          </div>
          {loginError && <p className="text-sm text-red-600 dark:text-red-400">{loginError}</p>}
          <LoadingButton type="submit" loading={pending} loadingText="Logging in..." disabled={pending} data-testid="login-submit-button">
            Log In
          </LoadingButton>
        </form>
        <div className="text-center text-sm mt-4">
          <span className="text-gray-600 dark:text-gray-400">Don&apos;t have an account? </span>
          <Link href="/register" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium" data-testid="login-signup-link">
            Sign up
          </Link>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
