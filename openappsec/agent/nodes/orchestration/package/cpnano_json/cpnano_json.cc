 

#include "picojson.h"

using namespace std;

int
main(int argc, char **argv)
{
    if (argc == 2 && (string(argv[1]) == "-h" || string(argv[1]) == "--help")) {
        cout << "Use standard input to send the JSON string. "
                "Prettified JSON will be sent to the standard output" << endl;
        return 1;
    }
    picojson::value json;
    cin >> json;
    string maybe_err = picojson::get_last_error();
    if (!maybe_err.empty()) {
        cerr << maybe_err << endl;
        return 1;
    }
    cout << json.serialize(true, false) << endl;
    return 0;
}
