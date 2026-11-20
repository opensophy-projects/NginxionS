 

#ifndef __NODE_COMPONENTS_IMPL_H__
#define __NODE_COMPONENTS_IMPL_H__

#ifndef __COMPONENTS_LIST_H__
#error node_components_impl.h should not be included directly!
#endif // __COMPONENTS_LIST_H__

template <typename ... Components>
int
NodeComponents<Components...>::run(const std::string &nano_service_name, int argc, char **argv)
{
    std::vector<std::string> arg_vec(argv, argv+argc);

    try {
        Infra::ComponentListCore<Components...>::handleArgs(arg_vec);

        Infra::ComponentListCore<Components...>::preloadComponents(nano_service_name);
        Infra::ComponentListCore<Components...>::loadConfiguration(arg_vec);

        Infra::ComponentListCore<Components...>::init();
        Infra::ComponentListCore<Components...>::run(nano_service_name);
        Infra::ComponentListCore<Components...>::fini();
    } catch (const Infra::ComponentListException &comp_exception) {
        if (comp_exception.getIsError()) {
            std::cerr << "Error: " << comp_exception.getError() << std::endl;
            abort();
        } else {
            std::cout << comp_exception.getError() << std::endl;
            return 0;
        }
    } catch (const std::exception &exception) {
        std::cerr << "Error: " << exception.what() << std::endl;
        abort();
    } catch (...) {
        std::cerr << "Error: Caught unknown exception" << std::endl;
        abort();
    }
    return 0;
}

#endif // __NODE_COMPONENTS_IMPL_H__
