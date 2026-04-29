/**
 * Admin Routes
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { uploadSingle, uploadReceipt, uploadMultiple, uploadPhotos } = require('../middleware/upload');
const {
  projectValidation,
  userValidation,
  machineValidation,
  stockValidation,
  vendorValidation,
  expenseValidation
} = require('../middleware/validators');

const {
  getDashboard,
  getProjects,
  getProjectDetail,
  createProject,
  updateProject,
  deleteProject,
  getMachines,
  createMachine,
  updateMachine,
  deleteMachine,
  returnRentedMachine,
  getStocks,
  createStock,
  updateStock,
  deleteStock,
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  recordVendorPayment,
  getVendorPayments,
  getExpenses,
  createExpense,
  deleteExpense,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getContractors,
  createContractor,
  updateContractor,
  deleteContractor,
  getContractorPayments,
  createContractorPayment,
  getTransfers,
  createTransfer,
  getAccounts,
  addCapital,
  addTransaction,
  generateReport,
  getAttendance,
  getLabourAttendance,
  getLabourPayments,
  getNotifications,
  sendNotification,
  markNotificationRead,
  getLabours,
  addLabEquipment,
  getLabEquipments,
  addConsumableGoods,
  getConsumableGoods,
  addEquipment,
  getEquipments,
  allocateFunds,
  getBankDetails,
  addBankDetail,
  getBankDetailWithTransactions,
  transferBankToBank,
  deleteTransaction,
  deleteVendorPayment,
  deleteContractorPayment,
  createItemName,
  getItemNames,
  deleteItemName,
  verifyPassword,
  getProfile
} = require('../controllers/adminController');

const {
  getCreditors,
  createCreditor,
  updateCreditor,
  deleteCreditor,
  getCreditorDetails,
  recordCreditorPayment
} = require('../controllers/creditorController');

const {
  updateBankDetail,
  deleteBankDetail
} = require('../controllers/bankController');

const {
  createTodo,
  getProjectTodos,
  deleteTodo
} = require('../controllers/todoController');

// Apply authentication and admin middleware to all routes
router.use(isAuthenticated);
router.use(isAdmin);

// Dashboard
router.get('/dashboard', getDashboard);

// Profile
router.get('/profile', getProfile);

// Password Verification
router.post('/verify-password', verifyPassword);

// Projects
router.get('/projects', getProjects);
router.get('/projects/:id', getProjectDetail);
router.post('/projects', projectValidation, createProject);
router.put('/projects/:id', updateProject);
router.delete('/projects/:id', deleteProject);
router.get('/projects/:projectId/todos', getProjectTodos);
router.post('/projects/:projectId/todos', createTodo);
router.delete('/todos/:id', deleteTodo);

// Machines
router.get('/machines', getMachines);
router.post('/machines', uploadSingle, machineValidation, createMachine);
router.put('/machines/:id', uploadSingle, updateMachine);
router.delete('/machines/:id', deleteMachine);
router.post('/machines/:id/return', returnRentedMachine);

// Stock
router.get('/stocks', getStocks);
router.post('/stocks', uploadPhotos, stockValidation, createStock);
router.put('/stocks/:id', uploadPhotos, updateStock);
router.delete('/stocks/:id', deleteStock);

// Vendors
router.get('/vendors', getVendors);
router.post('/vendors', uploadMultiple, vendorValidation, createVendor);
router.put('/vendors/:id', updateVendor);
router.delete('/vendors/:id', deleteVendor);
router.post('/vendors/payment', uploadReceipt, recordVendorPayment);
router.delete('/vendors/payments/:id', deleteVendorPayment);
router.get('/vendors/:vendorId/payments', getVendorPayments);

// Expenses
router.get('/expenses', getExpenses);
router.post('/expenses', uploadSingle, expenseValidation, createExpense);
router.delete('/expenses/:id', deleteExpense);

// Users (Site Managers)
router.get('/users', getUsers);
router.post('/users', userValidation, createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Contractors
router.get('/contractors', getContractors);
router.post('/contractors', uploadMultiple, createContractor);
router.put('/contractors/:id', updateContractor);
router.delete('/contractors/:id', deleteContractor);
router.get('/contractors/:contractorId/payments', getContractorPayments);
router.post('/contractors/payments', uploadReceipt, createContractorPayment);
router.delete('/contractors/payments/:id', deleteContractorPayment);

// Transfers
router.get('/transfers', getTransfers);
router.post('/transfers', createTransfer);

// Accounts
router.get('/accounts', getAccounts);
router.post('/accounts/capital', addCapital);
router.post('/accounts/transaction', addTransaction);
router.delete('/accounts/transaction/:id', deleteTransaction);
router.post('/accounts/allocate', allocateFunds);

// Reports
router.get('/reports', generateReport);

// Attendance
router.get('/attendance', getAttendance);
router.get('/labour-attendance', getLabourAttendance);

// Labours
router.get('/labours', getLabours);

// Lab Equipment
router.get('/lab-equipments', getLabEquipments);
router.post('/lab-equipments', uploadSingle, addLabEquipment);

// Consumable Goods
router.get('/consumable-goods', getConsumableGoods);
router.post('/consumable-goods', uploadSingle, addConsumableGoods);

// Equipment
router.get('/equipments', getEquipments);
router.post('/equipments', uploadSingle, addEquipment);

// Notifications
router.get('/notifications', getNotifications);
router.post('/notifications', sendNotification);
router.put('/notifications/:id/read', markNotificationRead);

// Bank Details
router.get('/bank-details', isAuthenticated, isAdmin, getBankDetails);
router.post('/bank-details', isAuthenticated, isAdmin, addBankDetail); // Add ID validation if needed
router.put('/bank-details/:id', isAuthenticated, isAdmin, updateBankDetail);
router.delete('/bank-details/:id', isAuthenticated, isAdmin, deleteBankDetail);
router.get('/bank-details/:id', isAuthenticated, isAdmin, getBankDetailWithTransactions);
router.post('/bank-details/transfer', isAuthenticated, isAdmin, transferBankToBank);

// Item Names (for dropdowns)
router.post('/item-names', createItemName);
router.get('/item-names', getItemNames);
router.delete('/item-names/:id', deleteItemName);

// Creditors
router.get('/creditors', getCreditors);
router.post('/creditors', createCreditor);
router.put('/creditors/:id', updateCreditor);
router.delete('/creditors/:id', deleteCreditor);
router.get('/creditors/:id', getCreditorDetails);
router.post('/creditors/payment', recordCreditorPayment);

module.exports = router;
