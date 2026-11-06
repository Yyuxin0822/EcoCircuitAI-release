from flaskr.ecocircuit.method._util.graph import Graph
import colorsys
import re


class Parser:
    @staticmethod
    def parse_system(syscolor=None):
        if syscolor is None:
            syscolor = {}

        def parse_rgb_string(rgb_string):
            nums = re.findall(r"\d+", rgb_string)
            if len(nums) >= 3:
                return tuple(int(n) / 255.0 for n in nums[:3])
            return (0, 0, 0)

        def hex_to_rgb(hex_color):
            hex_color = hex_color.lstrip("#")
            if len(hex_color) == 3:
                hex_color = "".join([c * 2 for c in hex_color])
            try:
                return tuple(int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
            except ValueError:
                return (0, 0, 0)

        def color_to_hue(color_str):
            if color_str.startswith("rgb"):
                r, g, b = parse_rgb_string(color_str)
            elif color_str.startswith("#"):
                r, g, b = hex_to_rgb(color_str)
            else:
                # Unknown or unsupported color format
                r, g, b = (0, 0, 0)  # default fallback
            h, _, _ = colorsys.rgb_to_hsv(r, g, b)
            return h

        # Validate structure and filter only valid entries
        valid_syscolor = {
            k: v
            for k, v in syscolor.items()
            if isinstance(v, list) and len(v) > 0 and isinstance(v[0], str)
        }

        # Sort the colors by hue (high to low)
        sorted_syscolor = dict(
            sorted(
                valid_syscolor.items(),
                key=lambda item: color_to_hue(item[1][0]),
                reverse=True,
            )
        )

        print("sorted_syscolor:", sorted_syscolor)
        return sorted_syscolor

    @staticmethod
    def parse_io(data):
        export_iodata = {}

        system_dict = {
            sys.name.upper(): sys.system.upper() for sys in data["nodesystem"].system
        }

        syscolor_order = {
            key.upper(): idx for idx, key in enumerate(data["syscolor"].keys())
        }

        g = Graph()
        first_col, second_col, third_col = set(), set(), set()
        requested_syslist = data.get("syscolor", {}).keys()
        for flow in data["process"]:
            g.add_edge(flow.source.upper(), flow.method.upper())
            g.add_edge(flow.method.upper(), flow.target.upper())
            source = flow.source.upper()
            method = flow.method.upper()
            target = flow.target.upper()
            first_col.add(source)
            second_col.add(method)
            third_col.add(target)

            # try:
            #     source = flow.source.upper()
            #     method = flow.method.upper()
            #     target = flow.target.upper()

            #     source_check = system_dict.get(source, "") in requested_syslist
            #     method_check = system_dict.get(method, "") in requested_syslist
            #     target_check = system_dict.get(target, "") in requested_syslist

            #     # If all three checks pass, add and remove the flow
            #     if source_check and method_check and target_check:
            #         first_col.add(source)
            #         second_col.add(method)
            #         third_col.add(target)
            #         g.add_edge(flow.source.upper(), flow.method.upper())
            #         g.add_edge(flow.method.upper(), flow.target.upper())
            #     else:
            #         data["process"].remove(flow)

            # except Exception as e:
            #     print(f"Error processing flow: {flow}, Error: {e}")


        def sort_by_system_then_alpha(nodes):
            return sorted(
                nodes,
                key=lambda x: (
                    syscolor_order.get(
                        system_dict.get(x.upper(), ""), len(syscolor_order)
                    ),
                    x,
                ),
            )

        first_col = sort_by_system_then_alpha(first_col)
        second_col = sort_by_system_then_alpha(second_col)
        third_col = sort_by_system_then_alpha(third_col)

        import numpy as np

        max_len = max(len(first_col), len(second_col), len(third_col))
        first_col += [None] * (max_len - len(first_col))
        second_col += [None] * (max_len - len(second_col))
        third_col += [None] * (max_len - len(third_col))

        arr = np.array([first_col, second_col, third_col]).T

        nodes = Parser.arr_to_nodes(arr, system_dict)

        export_iodata["nodes"] = nodes
        export_iodata["links"] = g.get_all_edges()

        return export_iodata

    @staticmethod
    def parse_metabolism(data):

        export_data = {}

        system_dict = {
            sys.name.upper(): sys.system.upper() for sys in data["nodesystem"].system
        }

        # Get the sorted method sequence from parsed_io (second_col)
        method_sequence = [
            node["name"].upper()
            for node in data["parsed_io"]["nodes"]
            if node["col"] == 1
        ]

        method_order = {name: idx for idx, name in enumerate(method_sequence)}

        sorted_process = sorted(
            data["process"],
            key=lambda x: method_order.get(x.method.upper(), len(method_order)),
        )

        export_process = []
        current_index = 0
        for flow in sorted_process:
            sub_g = Graph()

            for io in flow.flow:
                for j in range(len(io) - 1):
                    sub_g.add_edge(io[j].upper(), io[j + 1].upper())

            sub_matrix = sub_g.create_erd_matrix(
                flow.source.upper(), flow.target.upper()
            )

            if sub_matrix is None:
                continue

            export_process.append(
                {
                    "id": current_index,
                    "source": flow.source,
                    "target": flow.target,
                    "method": {
                        "name": flow.method,
                        "system": system_dict.get(flow.method.upper(), "Unknown"),
                    },
                    "nodes": Parser.arr_to_nodes(sub_matrix, system_dict),
                    "links": sub_g.get_all_edges(),
                }
            )
            current_index += 1

        nodes = {node["name"] for flow in export_process for node in flow["nodes"]}

        for circularflow in data["feedback"].loop:
            circularflow.flow = [f for f in circularflow.flow if f.upper() in nodes]

        export_feedback = []

        current_index = 0
        from collections import defaultdict

        system_index = defaultdict(int)

        for circularflow in data["feedback"].loop:
            if (
                len(circularflow.flow) < 2
                or circularflow.flow[0].upper() != circularflow.flow[-1].upper()
            ):
                continue

            feedback_g = Graph()
            for j in range(len(circularflow.flow) - 1):
                feedback_g.add_edge(
                    circularflow.flow[j].upper(), circularflow.flow[j + 1].upper()
                )

            feedback_flows = feedback_g.get_all_edges()

            if len(set(node for flow in feedback_flows for node in flow)) <= 3:
                continue

            system = system_dict.get(circularflow.name.upper(), "Unknown")
            system_index[system] += 1

            export_feedback.append(
                {
                    "id": current_index,
                    "sid": system_index[system],
                    "name": circularflow.name,
                    "system": system,
                    "links": feedback_flows,
                }
            )
            current_index += 1

        export_data["feedback"] = export_feedback
        export_data["process"] = export_process

        return export_data

    # helper function
    @staticmethod
    def arr_to_nodes(arr, sysdict):

        nodes = []

        for row_idx, row in enumerate(arr):
            for col_idx, cell in enumerate(row):
                if cell is not None:
                    node = {
                        "name": cell,
                        "col": col_idx,
                        "row": row_idx,
                        "system": sysdict.get(cell.upper(), "Unknown"),
                    }
                    nodes.append(node)

        return nodes
