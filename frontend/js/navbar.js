/**
 * Renders the top navbar into <div id="navbar"></div> based on login state.
 * Include after api.js on every page.
 */
function renderNavbar(activePage = '') {
  const el = document.getElementById('navbar');
  if (!el) return;
  const user = Auth.getUser();

  let links = `<a href="index.html">Marketplace</a>`;

  if (user && user.role === 'customer') {
    links += `
      <a href="cart.html">Cart</a>
      <a href="orders.html">My Orders</a>
      <a href="addresses.html">Addresses</a>`;
  } else if (user && user.role === 'farmer') {
    links += `
      <a href="farmer-dashboard.html">My Products</a>
      <a href="farmer-orders.html">Orders</a>
      <a href="farmer-wallet.html">Wallet</a>`;
  } else if (user && user.role === 'admin') {
    links += `<a href="admin-dashboard.html">Admin Dashboard</a>`;
  }

  if (user) {
    links += `<span style="color:#cfe3d1;font-size:14px;">Hi, ${user.name.split(' ')[0]}</span>
      <button class="link" id="logoutBtn" style="background:none;border:none;cursor:pointer;">Logout</button>`;
  } else {
    links += `<a href="login.html">Login</a> <a href="register.html">Register</a>`;
  }

  el.innerHTML = `
    <div class="container">
      <a href="index.html" class="brand">🌾 KrushiSetu</a>
      <nav>${links}</nav>
    </div>`;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await api.post('/auth/logout'); } catch { /* ignore */ }
      Auth.logoutRedirect('index.html');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => renderNavbar());
