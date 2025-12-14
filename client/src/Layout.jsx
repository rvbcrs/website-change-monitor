import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Settings, Radar, Menu, X, LogOut, User } from 'lucide-react'
import { useAuth } from './contexts/AuthContext'

function Layout({ children }) {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { user, logout } = useAuth();

  // Close menu when route changes
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location]);

  const navItems = [
    { icon: <LayoutDashboard size={20} />, label: 'Monitoring', path: '/' },
    { icon: <Settings size={20} />, label: 'Settings', path: '/settings' },
    { icon: <User size={20} />, label: 'Users', path: '/users', adminOnly: true },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#0d1117] text-white font-sans">
      
      {/* Top Header Bar */}
      <header className="h-16 border-b border-gray-800 flex items-center gap-4 px-4 bg-[#161b22] sticky top-0 z-40 shrink-0">
        {/* Hamburger Menu Button */}
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 hover:bg-gray-800 rounded-md text-gray-400 hover:text-white transition-colors"
          title="Open Menu"
        >
          <Menu size={24} />
        </button>

        {/* Logo */}
        <Link to="/" className="flex items-center gap-3">
          <Radar className="text-green-500" size={28} />
          <span className="font-bold text-xl">DeltaWatch</span>
        </Link>
      </header>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sliding Sidebar Drawer */}
      <div className={`
        fixed inset-y-0 left-0 z-50 
        w-72 bg-[#161b22] border-r border-gray-800 flex flex-col 
        transform transition-transform duration-300 ease-in-out shadow-2xl
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
      `}>
        {/* Sidebar Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800">
          <span className="font-semibold text-lg">Menu</span>
          <button 
            onClick={() => setIsSidebarOpen(false)} 
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* User Info (if logged in) */}
        {user && (
            <div className="px-4 py-4 border-b border-gray-800 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-900/50 flex items-center justify-center text-blue-400">
                    <User size={16} />
                </div>
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium text-white truncate">{user.email}</p>
                    <p className="text-xs text-gray-500 uppercase">{user.role}</p>
                </div>
            </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.filter(item => !item.adminOnly || (user && user.role === 'admin')).map((item) => (
            <Link 
              key={item.label} 
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                location.pathname === item.path 
                  ? 'bg-[#1f6feb] text-white' 
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 space-y-4">
            {user ? (
                 <button 
                    onClick={logout}
                    className="w-full flex items-center justify-center gap-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 px-4 py-2 rounded-lg transition-colors border border-red-900/50"
                 >
                    <LogOut size={16} /> Logout
                 </button>
            ) : (
                <Link 
                    to="/login"
                    className="w-full flex items-center justify-center gap-2 bg-[#21262d] hover:bg-[#30363d] text-white px-4 py-2 rounded-lg transition-colors border border-gray-700"
                >
                    Login
                </Link>
            )}
           
           <div className="text-center text-xs text-gray-500 pt-2">
             DeltaWatch v1.0
           </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8">
        {children}
      </main>
    </div>
  )
}

export default Layout;
export { Layout };

