from flaskr.ecocircuit.method import Task
from openai import AsyncOpenAI
from flaskr.account.api_utils import APIUsageTracker
import logging

class Pipeline:
    _logging_initialized = False  # Class-level variable to prevent repeated setup

    def __init__(self, clientasync: AsyncOpenAI, tasks: Task, progress_callback=None, log_usage=True, log_file='logs/ecocircuit_usage.log'):
        self.progress_callback = progress_callback
        self.tasks = tasks
        self.clientasync = clientasync
        self.usage_tracker = APIUsageTracker()
        self.log_usage = log_usage
        self.log_file = log_file

        for task in self.tasks:
            task.clientasync = clientasync
            task.usage_tracker = self.usage_tracker

        if self.log_usage and not Pipeline._logging_initialized:
            self.logger = logging.getLogger('ecocircuit_pipeline')
            self.logger.setLevel(logging.INFO)

            file_handler = logging.FileHandler(self.log_file)
            file_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))

            self.logger.addHandler(file_handler)
            Pipeline._logging_initialized = True
        elif self.log_usage:
            self.logger = logging.getLogger('ecocircuit_pipeline')

    async def run(self, initial_data):
        print(f"Running pipeline with progress callback: {self.progress_callback is not None}")
        data = initial_data or {}
        total_tasks = len(self.tasks)

        for idx, task in enumerate(self.tasks):
            task_name = task.__class__.__name__
            task_message = getattr(task, 'task_message', f"Starting task: {task_name}")
            percent_complete = (idx / total_tasks) * 100
            print(f"Starting task {idx+1}/{total_tasks}: {task_name}")

            if self.progress_callback:
                self.progress_callback(
                    percent_complete,
                    f'Agent starting task {idx+1}/{total_tasks}: {task_message} ... Total processes take 1-2 minutes. Thanks for your patience.'
                )

            data = await task.solve(data)

            if data is None:
                if self.progress_callback:
                    self.progress_callback(
                        percent_complete,
                        f'Task {idx+1}/{total_tasks} failed: {task_message}'
                    )
                return None

        completion_message = 'EcoCircuit pipeline complete!'
        if self.progress_callback:
            self.progress_callback(100, completion_message)

        if self.log_usage:
            report = self.usage_tracker.report()
            report_message = f'{completion_message} Usage report: {report}'
            self.logger.info(report_message)

        return data

    def parse(self, data):
        pass

if __name__ == "__main__":
    pass


