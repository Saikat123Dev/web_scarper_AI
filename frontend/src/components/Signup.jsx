import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const GoogleSignupPage = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleCredentialResponse = useCallback(async (response) => {
    setLoading(true);
    setError('');

    try {
      const result = await fetch('http://localhost:4001/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: response.credential }),
      });

      const data = await result.json();

      if (data.success) {
        setUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        // ✅ redirect to scrape page
        navigate('/scrape');
      } else {
        setError(data.message || 'Authentication failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      console.error('Auth error:', err);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    const initializeGoogleSignIn = () => {
      if (window.google) {
        try {
          window.google.accounts.id.initialize({
            client_id:import.meta.env.VITE_GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true,
          });

          window.google.accounts.id.renderButton(
            document.getElementById('google-signin-button'),
            { theme: 'outline', size: 'large', width: '100%', text: 'signup_with' }
          );
        } catch (err) {
          console.error('Google Sign-In initialization error:', err);
          setError('Failed to initialize Google Sign-In');
        }
      }
    };

    if (!window.google) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = initializeGoogleSignIn;
      script.onerror = () =>
        setError('Failed to load Google Sign-In. Please check your internet connection.');
      document.head.appendChild(script);
    } else {
      initializeGoogleSignIn();
    }
  }, [handleCredentialResponse]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 via-indigo-100 to-white flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-10 relative overflow-hidden">
        {/* Decorative top bar */}
        <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-blue-500 to-indigo-500"></div>

        {/* Heading */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-800">Create Your Account</h1>
          <p className="text-gray-500 mt-2">Sign up with your Google account to continue</p>
        </div>

        {/* Error box */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl shadow-sm">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Google Sign-In Button */}
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-lg">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          <div id="google-signin-button" className="w-full"></div>
        </div>

        {/* Terms */}
        <p className="text-xs text-gray-500 text-center mt-6">
          By signing up, you agree to our{' '}
          <a href="#" className="text-blue-600 hover:text-blue-700 font-medium">Terms of Service</a>{' '}
          and{' '}
          <a href="#" className="text-blue-600 hover:text-blue-700 font-medium">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
};

export default GoogleSignupPage;
