const { Todo, Project } = require('../models');

/**
 * @desc    Create a new todo for a project
 * @route   POST /api/admin/projects/:projectId/todos
 * @access  Private/Admin
 */
exports.createTodo = async (req, res) => {
    try {
        const { task, priority, dueDate } = req.body;
        const { projectId } = req.params;

        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const todo = await Todo.create({
            task,
            priority,
            dueDate,
            projectId,
            assignedBy: req.user._id
        });

        res.status(201).json({ success: true, data: todo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Get all todos for a project
 * @route   GET /api/admin/projects/:projectId/todos
 * @access  Private (Admin & Site Manager)
 */
exports.getProjectTodos = async (req, res) => {
    try {
        const { projectId } = req.params;
        const todos = await Todo.find({ projectId }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: todos });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Update todo status
 * @route   PATCH /api/site/todos/:id/status
 * @access  Private/Site Manager
 */
exports.updateTodoStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const todo = await Todo.findById(req.params.id);

        if (!todo) {
            return res.status(404).json({ success: false, error: 'Todo not found' });
        }

        todo.status = status;
        todo.lastUpdatedBy = req.user._id;
        await todo.save();

        res.status(200).json({ success: true, data: todo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Delete a todo
 * @route   DELETE /api/admin/todos/:id
 * @access  Private/Admin
 */
exports.deleteTodo = async (req, res) => {
    try {
        const todo = await Todo.findByIdAndDelete(req.params.id);
        if (!todo) {
            return res.status(404).json({ success: false, error: 'Todo not found' });
        }
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
