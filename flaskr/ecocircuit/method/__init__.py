from flaskr.ecocircuit.method._task.base import Task
from flaskr.ecocircuit.method._task.io import IOTask, IO, IOList
from flaskr.ecocircuit.method._task.process import ProcessTask, Process, Method, FlowERD
from flaskr.ecocircuit.method._task.feedback import FeedbackTask, CircularFlow, Feedback
from flaskr.ecocircuit.method._task.nodesystem import SystemTask,  System, SystemList
from flaskr.ecocircuit.method._task.image import ImageTask
from flaskr.ecocircuit.method.pipelinebase import Pipeline
from flaskr.ecocircuit.method.metabolism import Metabolism

def get_task(name):
    if name == 'io':
        return IOTask()
    elif name == 'process':
        return ProcessTask()
    elif name == 'feedback':
        return FeedbackTask()
    elif name == 'system':
        return SystemTask()
    else:
        raise NotImplementedError
        