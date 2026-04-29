/**
 * Site Manager Routes
 * All routes require site manager authentication
 */

const express = require('express');
const router = express.Router();
const { isAuthenticated, isSiteManager } = require('../middleware/auth');
const { uploadSingle, uploadPhotos } = require('../middleware/upload');
const {
  labourValidation,
  attendanceValidation,
  expenseValidation
} = require('../middleware/validators');

const {
  getDashboard,
  markAttendance,
  getMyAttendance,
  getLabours,
  enrollLabour,
  updateLabour,
  markLabourAttendance,
  getLabourAttendance,
  addStockIn,
  getStocks,
  recordStockOut,
  getStockOuts,
  submitDailyReport,
  getDailyReports,
  uploadGalleryImages,
  getGalleryImages,
  addExpense,
  getExpenses,
  requestTransfer,
  getTransfers,
  payLabour,
  getPayments,
  getNotifications,
  markNotificationRead,
  getProfile,
  getVendors,
  getProjects,
  getMachines,
  getMaterials,
  getAllMaterialNames,
  getLabEquipments,
  getConsumableGoods,
  getEquipments,
  getSiteMachines,
  toggleMachineRentPause,
  getWalletTransactions,
  getOtherManagers,
  transferFunds,
  getContractors,
  payContractor,
  payVendor,
  updateLabourAttendance,
  getMachineDetails,
  getLabourDetails,
  getSiteContractors,
  addContractor,
  getContractorDetails,
  getProjectDetails,
  getContractorPayments,
  getVendorPayments,
  checkAttendanceStatus
} = require('../controllers/siteController');

const {
  getProjectTodos,
  updateTodoStatus
} = require('../controllers/todoController');

// Apply authentication and site manager middleware to all routes
router.use(isAuthenticated);
router.use(isSiteManager);

// Dashboard
router.get('/dashboard', getDashboard);

// Attendance (Site Manager's own)
router.post('/attendance', attendanceValidation, markAttendance);
router.get('/attendance', getMyAttendance);
router.get('/attendance-status', checkAttendanceStatus);

// Labour
router.get('/labours', getLabours);
router.post('/labours', labourValidation, enrollLabour);
router.put('/labours/:id', updateLabour);

// Labour Attendance
router.post('/labour-attendance', markLabourAttendance);
router.get('/labour-attendance', getLabourAttendance);
router.put('/labour-attendance/:id', updateLabourAttendance);

// Stock In
router.post('/stock-in', uploadPhotos, addStockIn);
router.get('/stocks', getStocks);

// Stock Out
router.post('/stock-out', uploadPhotos, recordStockOut);
router.get('/stock-outs', getStockOuts);

// Daily Report
router.post('/daily-reports', submitDailyReport);
router.get('/daily-reports', getDailyReports);

// Gallery
router.post('/gallery', uploadGalleryImages);
router.get('/gallery', getGalleryImages);

// Expenses
router.post('/expenses', uploadSingle, expenseValidation, addExpense);
router.get('/expenses', getExpenses);

// Transfer
router.post('/transfer', requestTransfer);
router.get('/transfers', getTransfers);

// Payment
router.post('/payments', payLabour); // Changed to plural to match frontend
router.get('/payments', getPayments);

// Notifications
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markNotificationRead);

// Profile
router.get('/profile', getProfile);

// Vendors (for dropdown)
router.get('/vendors', getVendors);

// Projects (assigned)
router.get('/projects', getProjects);
router.get('/projects/:id', getProjectDetails);
router.get('/projects/:projectId/todos', getProjectTodos);
router.patch('/todos/:id/status', updateTodoStatus);

// Machines (assigned)
router.get('/machines', getMachines);

// Materials (for transfer dropdown)
// Materials (for transfer dropdown)
router.get('/materials', getMaterials);

// All Material Names (for Stock In dropdown)
router.get('/all-materials', getAllMaterialNames);

// Lab Equipment
router.get('/lab-equipments', getLabEquipments);

// Consumable Goods
router.get('/consumable-goods', getConsumableGoods);

// Equipment
router.get('/equipments', getEquipments);

// Wallet & Transactions
router.get('/wallet-transactions', getWalletTransactions);
router.get('/other-managers', getOtherManagers);
router.post('/transfer-funds', transferFunds);

// Contractors
router.get('/contractors', getContractors);
router.post('/payments/contractor', payContractor);
router.get('/payments/contractor', getContractorPayments); // Added

// Vendor Payments
router.post('/payments/vendor', payVendor);
router.get('/payments/vendor', getVendorPayments); // Added

// Site Manager Machines
router.get('/site-machines', getSiteMachines);
router.get('/machines/:id/details', getMachineDetails);
router.put('/machines/:id/pause', toggleMachineRentPause);

// Labour Details
router.get('/labours/:id/details', getLabourDetails);

// Contractors Management
router.get('/site-contractors', getSiteContractors);
router.post('/contractors', addContractor);
router.get('/contractors/:id/details', getContractorDetails);

module.exports = router;
