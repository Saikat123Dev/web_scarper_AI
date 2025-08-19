import { useNavigate } from "react-router-dom";

const LogoutButton = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    // Clear local storage
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    // Revoke Google session (optional but cleaner)
    if (window.google && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }

    // Redirect back to landing page
    navigate("/");
  };

  return (
    <button
      onClick={handleLogout}
      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg shadow-md transition"
    >
      Logout
    </button>
  );
};

export default LogoutButton;
