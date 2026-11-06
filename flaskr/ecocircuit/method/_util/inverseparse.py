from flaskr.ecocircuit.method import IO, IOList, Process, Method, FlowERD, CircularFlow, Feedback, System, SystemList
class InverseParser:
    @staticmethod
    def inverse_parse_io(data):
        parsed_io = data["parsed_io"]

        nodes = parsed_io["nodes"]
        links = parsed_io["links"]

        input_nodes = [node["name"] for node in nodes if node["col"] == 0]
        method_nodes = [node["name"] for node in nodes if node["col"] == 1]
        output_nodes = [node["name"] for node in nodes if node["col"] == 2]

    
        input_links = [
            [link[0], link[1]]
            for link in links
            if link[0] in input_nodes and link[1] in method_nodes
        ]
        output_links = [
            [link[0], link[1]]
            for link in links
            if link[0] in method_nodes and link[1] in output_nodes
        ]

        imo_links = set()
        for node in method_nodes:
            inputs = [link[0] for link in input_links if link[1] == node]
            outputs = [link[1] for link in output_links if link[0] == node]
            for i in inputs:
                for o in outputs:
                    imo_links.add((i, o))
        
        io_links = [
            [link[0], link[1]]
            for link in links
            if link[0] in input_nodes and link[1] in output_nodes
        ]

        iso_input = [node for node in input_nodes if node not in [link[0] for link in io_links] and node not in [link[0] for link in imo_links]]
        iso_output = [node for node in output_nodes if node not in [link[1] for link in io_links] and node not in [link[1] for link in imo_links]]
        
        if imo_links:
            data["computed_io"] = IOList(
                iolist=[IO(input=link[0], output=link[1]) for link in imo_links]
            )
        if io_links:
            data["io"] = IOList(
                iolist=[IO(input=link[0], output=link[1]) for link in io_links]
            )

        if iso_input:
            data["iso_input"] = iso_input
        if iso_output:
            data["iso_output"] = iso_output
        
        return data

    @staticmethod
    def inverse_parse_process(data):
        method_nodes = [
            node["name"] for node in data["parsed_io"]["nodes"] if node["col"] == 1
        ]
        links = data["parsed_io"].get("links", [])
        input_nodes = [link[0] for link in links if link[0] not in method_nodes]
        output_nodes = [link[1] for link in links if link[1] not in method_nodes]
        
        parsed_process = data["parsed_metabolism"]["process"]
        processes = []
        pop_proc_idx = set()
        for i, proc in enumerate(parsed_process):
            method = proc["method"]["name"].upper()

            if method not in method_nodes or proc["source"] not in input_nodes or proc["target"] not in output_nodes:
                pop_proc_idx.add(i)
                continue

            method = FlowERD(
                source=proc["source"],
                target=proc["target"],
                method=method,
                flow=proc["links"],
            )
            processes.append(method)

        for i in sorted(pop_proc_idx, reverse=True):
            parsed_process.pop(i)
        data["parsed_metabolism"]["process"] = parsed_process
        data["computed_process"] = processes

        return data


    @staticmethod
    def inverse_parse_system(data):
        # we need to check the data["syscolor"].keys() to get the computed_syslist
        requested_syslist = data.get("syscolor", {}).keys()
        requested_syslist = [sys.upper() for sys in requested_syslist]
        parsed_process = data["parsed_metabolism"]["process"]

        # initialize with an empty list explicitly
        node_system = SystemList(system=[])

        for proc in parsed_process:
            method_system = proc["method"].get("system")
            #if method_system and method_system in data["syscolor"].keys():
            if method_system and method_system in requested_syslist:
                system = System(name=proc["method"]["name"], system=method_system)
                node_system.system.append(system)  # Use .append() directly on the list

            for node in proc["nodes"]:
         
                node_sys = node.get("system")
                #if node_sys and node_sys in data["syscolor"].keys():
                if node_sys and node_sys in requested_syslist:
                    system = System(name=node["name"], system=node_sys)
                    node_system.system.append(system)

        data["computed_nodesystem"] = node_system
        computed_syslist = list(set([sys.system for sys in node_system.system]))
        print("computed_syslist", computed_syslist)
        print("requested_syslist", requested_syslist)
        #if requested_syslist has item that is not in computed_syslist, add it to data["iso_syslist"]
        data["iso_syslist"] = list(set(requested_syslist) - set(computed_syslist))
        if len(data["iso_syslist"]) == 0:
            data.pop("iso_syslist", None)
        return data
    
    @staticmethod
    def inverse_parse_feedback(data):
        nodes_io = [node["name"] for node in data["parsed_io"].get("nodes", [])]
        nodes_process = [node["name"] for proc in data["parsed_metabolism"]["process"] for node in proc["nodes"]]
        nodes = list(set(nodes_io + nodes_process))
        parsed_feedback = data["parsed_metabolism"]["feedback"]
        feedback_loops = []

        for loop in parsed_feedback:
            flow_sequence = [link[0] for link in loop["links"] if link[0] in nodes]
            # Add the last target to complete the loop explicitly
            if loop["links"][-1][1] in nodes:
                flow_sequence.append(loop["links"][-1][1]) 
            if len(flow_sequence) < 3:
                continue
            circular_flow = CircularFlow(name=loop["name"], flow=flow_sequence)
            feedback_loops.append(circular_flow)

        data["computed_feedback"] = Feedback(loop=feedback_loops)
        return data
   
    
    
if __name__ == "__main__":
    pass
