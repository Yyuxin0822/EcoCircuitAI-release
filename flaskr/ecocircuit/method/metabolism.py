from flaskr.ecocircuit.method import (
    IOTask,
    ProcessTask,
    FeedbackTask,
    SystemTask,
    ImageTask,
    Pipeline,
)
from flaskr.ecocircuit.method import IOList, SystemList, Feedback, Process
from flaskr.ecocircuit.method._util.dataparser import Parser
from flaskr.ecocircuit.method._util.inverseparse import InverseParser
import asyncio
def progress_callback(percent, message):
    print(f"{percent:.2f}% complete: {message}")

class Metabolism(Pipeline):
    def __init__(self, clientasync, tasks=None, progress_callback=None, log_usage=True, log_file='logs/ecocircuit_usage.log'):
        if tasks is None:
            tasks = [
                ImageTask(),
                IOTask(),
                ProcessTask(),
                FeedbackTask(),
                SystemTask(),
            ]

        # No need to explicitly set clientasync here, handled by Pipeline
        super().__init__(clientasync, tasks, progress_callback, log_usage, log_file)


    async def run(self, initial_data=None):
        #create a deep copy of the initial data
        deepcopy_initial_data = initial_data.copy()
        # data conversion before running the pipeline
        if initial_data.get("syscolor"):
            initial_data["syslist"] = list(initial_data["syscolor"].keys())


        img_url = ImageTask.s3_genurl(f"{initial_data.get('id')}.jpg")
        if img_url:
            print("Image URL:", img_url)    
            initial_data["image"] = img_url

        # syslist, one of the prompting material must be provided
        if bool(initial_data is None) or bool(initial_data.get("syslist") is None) or bool(
            initial_data.get("env") is None and initial_data.get("image") is None
        ):  
            return None

        # if this is a first run or an iteration        
        # checker needs to be updated 
        is_iteration = bool(
            initial_data.get("parsed_io") and initial_data.get("parsed_metabolism") 
        )

        if not is_iteration:
            print("This is a first run")
            # this is not likely to be the case for the first run, but just in case
            if initial_data.get("image") and initial_data.get("env"):
                self.tasks = [task for task in self.tasks if not isinstance(task, ImageTask)]
            data = await super().run(initial_data)
        else:
            print("This is an iteration")
            data = self.inverse_parse(initial_data)
            # computed_syslist with inversing data 
            # with open("inverse_parse.py", "w") as f:
            #     f.write(str(data))
            
            # this should be the case for all iterations
            if initial_data.get("image") and initial_data.get("env"):
                self.tasks = [task for task in self.tasks if not isinstance(task, ImageTask)]
            
            #if data has   "iso_syslist" or "iso_input" or "iso_output" or "io"
            if data.get("iso_input") or data.get("iso_output") or data.get("io") or data.get("iso_syslist"):
                if data.get("iso_syslist"):
                    print("iso_syslist", data["iso_syslist"])
                    # let's get some iso_input and iso_output
                
                # only when there are io, iso_input, iso_output situation (in this way, it excludes the situation where it is just 
                # deleting flows / nodes, but not adding new ones)

                if not data.get("iso_input") and not data.get("iso_output") and not data.get("iso_syslist"):
                    self.tasks = [task for task in self.tasks if not isinstance(task, IOTask)]
                data = await super().run(data)
            else:
                print("no need to run pipeline")

            data["io"] = IOList(
                iolist=(data.get("io").iolist if data.get("io") else [])
                + (data.get("computed_io").iolist if data.get("computed_io") else [])
            )

            data["process"] = data.get("process", [])
            if "computed_process" in data:
                data["process"].extend(data["computed_process"])

            data["feedback"] = Feedback(
                loop=(data.get("feedback").loop if data.get("feedback") else [])
                + (data.get("computed_feedback").loop if data.get("computed_feedback") else [])
            )

            data["nodesystem"] = SystemList(
                system=(data.get("nodesystem").system if data.get("nodesystem") else [])
                + (data.get("computed_nodesystem").system if data.get("computed_nodesystem") else [])
            )

            # Safely remove computed keys if they exist
            for key in ["computed_io", "computed_process", "computed_feedback", "computed_nodesystem"]:
                data.pop(key, None)
        try:
            data = self.parse(data)
        except Exception as e:
            print(f"Error parsing data: {e}")
            # Handle the error as needed
            return None

        return data

    def parse(self, data):
        data["syscolor"] = Parser.parse_system(data.get("syscolor"))
        data["parsed_io"] = Parser.parse_io(data)
        data["parsed_metabolism"] = Parser.parse_metabolism(data)
        if data.get("io"):
            data.pop("io")
        if data.get("process"):
            data.pop("process")
        if data.get("feedback"):
            data.pop("feedback")
        if data.get("nodesystem"):
            data.pop("nodesystem")
        return data

    def inverse_parse(self, data):
        parsed_data = InverseParser.inverse_parse_io(data)
        parsed_data = InverseParser.inverse_parse_process(data)
        parsed_data = InverseParser.inverse_parse_system(data)
        parsed_data= InverseParser.inverse_parse_feedback(data)
        return parsed_data




if __name__ == "__main__":
    pass

