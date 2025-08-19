// App.jsx
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import ScrappyLandingPage from './components/Landing';
import Scrappy from './components/Scrape';
import GoogleSignupPage from './components/Signup';

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<ScrappyLandingPage />} />
        <Route path="/signup" element={<GoogleSignupPage />} />
        <Route path="/scrape" element={<Scrappy />} />
      </Routes>
    </Router>
  );
};

export default App;
