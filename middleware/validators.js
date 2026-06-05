/**
 * Input Validation Middleware using express-validator
 * Validates and sanitizes all incoming requests
 */

const { body, validationResult } = require('express-validator');

// Middleware to check validation results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Login validation
const loginValidation = [
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate
];

// Project validation
const projectValidation = [
  body('name').trim().notEmpty().withMessage('Project name is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('budget').isNumeric().withMessage('Budget must be a number'),
  validate
];

// User (Site Manager) validation
const userValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  validate
];

// Labour validation
const labourValidation = [
  body('name').trim().notEmpty().withMessage('Labour name is required'),
  body('phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('dailyWage').isNumeric().withMessage('Daily wage must be a number'),
  body('designation').trim().notEmpty().withMessage('Designation is required'),
  validate
];

// Stock validation
const stockValidation = [
  body('projectId').notEmpty().withMessage('Project ID is required'),
  body('materialName').trim().notEmpty().withMessage('Material name is required'),
  body('unit').trim().notEmpty().withMessage('Unit is required'),
  body('quantity').isNumeric().withMessage('Quantity must be a number'),
  validate
];

// Vendor validation
const vendorValidation = [
  body('name').trim().notEmpty().withMessage('Vendor name is required'),
  body('contact').isMobilePhone().withMessage('Valid contact number is required'),
  validate
];

// Expense validation
const expenseValidation = [
  body('projectId').notEmpty().withMessage('Project ID is required'),
  body('name').trim().notEmpty().withMessage('Expense name is required'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  validate
];

// Machine validation
const machineValidation = [
  body('name').trim().notEmpty().withMessage('Machine name is required'),
  body('category').isIn(['big', 'lab', 'consumables', 'equipment']).withMessage('Invalid category'),
  body('quantity').optional(),  // Make quantity optional since consumables use text, machines use numbers

  // Conditional validation for rental machines
  body('creditorId').if(body('ownershipType').equals('rented'))
    .trim().notEmpty().withMessage('Creditor is required for rented machines'),
  body('perDayExpense').if(body('ownershipType').equals('rented'))
    .isNumeric().withMessage('Per day expense must be a number')
    .isFloat({ gt: 0 }).withMessage('Per day expense must be greater than 0'),

  validate
];

// Attendance validation
const attendanceValidation = [
  body('date').isISO8601().withMessage('Valid date is required'),
  body('projectId').notEmpty().withMessage('Project is required'),
  body('photo')
    .notEmpty().withMessage('Selfie photo is required')
    .custom((value) => {
      if (typeof value !== 'string' || !value.trim()) return false;
      if (value.startsWith('data:image/')) return true;
      if (value.startsWith('http://') || value.startsWith('https://')) return true;
      return false;
    })
    .withMessage('A valid selfie photo is required'),
  validate
];

module.exports = {
  validate,
  loginValidation,
  projectValidation,
  userValidation,
  labourValidation,
  stockValidation,
  vendorValidation,
  expenseValidation,
  machineValidation,
  attendanceValidation
};
